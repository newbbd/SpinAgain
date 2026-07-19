(() => {
  "use strict";

  const STARTING_BALANCE = 1000;
  const STORAGE_KEY = "spin-again-save-v1";
  const app = document.querySelector("#app");
  const balanceNode = document.querySelector("#balance");
  const profitNode = document.querySelector("#profit-loss");
  const toastNode = document.querySelector("#toast");
  const assets = window.DOODLE_ASSETS;

  const gameMeta = {
    slots: { title: "Slots", art: assets.slot, text: "Match doodled symbols and chase a clean line." },
    blackjack: { title: "Blackjack", art: assets.blackjack, text: "Beat the dealer without going over 21." },
    roulette: { title: "Roulette", art: assets.roulette, text: "Choose a simple bet and spin 0 through 36." },
    coin: { title: "Coin Flip", art: assets.coin, text: "Heads or tails. Nothing complicated." },
    horses: { title: "Horse Race", art: assets.horse, text: "Pick one of five equal-chance runners." }
  };

  let route = getInitialRoute();
  let busy = false;
  let toastTimer = null;
  let state = loadState();

  function createDefaultState() {
    return {
      balance: STARTING_BALANCE,
      startingBalance: STARTING_BALANCE,
      wagered: 0,
      returned: 0,
      wins: 0,
      losses: 0,
      pushes: 0,
      history: [],
      byGame: {
        slots: { plays: 0, wagered: 0, returned: 0 },
        blackjack: { plays: 0, wagered: 0, returned: 0 },
        roulette: { plays: 0, wagered: 0, returned: 0 },
        coin: { plays: 0, wagered: 0, returned: 0 },
        horses: { plays: 0, wagered: 0, returned: 0 }
      },
      blackjack: {
        active: false,
        bet: 0,
        deck: [],
        player: [],
        dealer: [],
        doubled: false,
        message: "Place a bet to deal."
      }
    };
  }

  function loadState() {
    const fallback = createDefaultState();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || typeof parsed !== "object") return fallback;
      const merged = {
        ...fallback,
        ...parsed,
        byGame: { ...fallback.byGame, ...(parsed.byGame || {}) },
        blackjack: { ...fallback.blackjack, ...(parsed.blackjack || {}) }
      };
      if (!Number.isFinite(merged.balance) || merged.balance < 0) return fallback;
      return merged;
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateWallet();
  }

  function updateWallet() {
    balanceNode.textContent = money(state.balance);
    const profit = state.balance - state.startingBalance;
    profitNode.textContent = profit === 0 ? "Even" : `${profit > 0 ? "+" : ""}${money(profit)}`;
  }

  function money(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2
    }).format(value);
  }

  function randomInt(max) {
    if (!Number.isInteger(max) || max <= 0) throw new Error("max must be a positive integer");
    const limit = Math.floor(0x100000000 / max) * max;
    const buffer = new Uint32Array(1);
    do {
      crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % max;
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function getInitialRoute() {
    const candidate = location.hash.replace("#", "");
    return ["home", "slots", "blackjack", "roulette", "coin", "horses", "stats"].includes(candidate)
      ? candidate
      : "home";
  }

  function go(nextRoute) {
    if (busy) return;
    route = nextRoute;
    location.hash = nextRoute;
    render();
    app.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    toastNode.textContent = message;
    toastNode.classList.add("show");
    toastTimer = setTimeout(() => toastNode.classList.remove("show"), 2200);
  }

  function parseBet(inputId) {
    const input = document.querySelector(`#${inputId}`);
    const bet = Number(input?.value);
    if (!Number.isFinite(bet) || bet < 1 || !Number.isInteger(bet)) {
      showToast("Enter a whole-number bet of at least $1.");
      return null;
    }
    if (bet > state.balance) {
      showToast("You do not have enough fake cash for that bet.");
      return null;
    }
    return bet;
  }

  function chargeBet(game, bet) {
    state.balance -= bet;
    state.wagered += bet;
    state.byGame[game].wagered += bet;
    saveState();
  }

  function settle(game, bet, payout, detail, resultOverride = null) {
    state.balance += payout;
    state.returned += payout;
    state.byGame[game].plays += 1;
    state.byGame[game].returned += payout;

    const net = payout - bet;
    const result = resultOverride || (net > 0 ? "win" : net < 0 ? "loss" : "push");
    if (result === "win") state.wins += 1;
    if (result === "loss") state.losses += 1;
    if (result === "push") state.pushes += 1;

    state.history.unshift({
      game,
      detail,
      bet,
      payout,
      net,
      time: Date.now()
    });
    state.history = state.history.slice(0, 60);
    saveState();
  }

  function quickBetButtons(inputId) {
    return `
      <div class="bet-row" aria-label="Quick bet amounts">
        ${[5, 10, 25, 50, 100].map(value => `<button class="bet-chip" type="button" data-set-bet="${value}" data-target="${inputId}">$${value}</button>`).join("")}
        <button class="bet-chip" type="button" data-set-max data-target="${inputId}">Max</button>
      </div>`;
  }

  function pageHead(key, intro) {
    const meta = gameMeta[key];
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">${meta.title}</h1>
          <p class="page-intro">${intro || meta.text}</p>
        </div>
        <img class="page-art" src="${meta.art}" alt="Hand-drawn ${meta.title.toLowerCase()} illustration">
      </div>`;
  }

  function render() {
    document.querySelectorAll("[data-route]").forEach(button => {
      button.classList.toggle("active", button.dataset.route === route);
    });

    const views = {
      home: renderHome,
      slots: renderSlots,
      blackjack: renderBlackjack,
      roulette: renderRoulette,
      coin: renderCoin,
      horses: renderHorses,
      stats: renderStats
    };

    app.innerHTML = views[route]();
    updateWallet();
  }

  function renderHome() {
    return `
      <section class="hero">
        <div>
          <h1>Lose fake money.<br>Win fake money.<br>Spin again.</h1>
          <p>A zero-budget, solo casino simulator. Everything stays in this browser, all bets use pretend cash, and every outcome uses the browser's cryptographic random generator.</p>
          <button class="button primary" type="button" data-route="slots">Start with Slots</button>
        </div>
        <img class="hero-art" src="${assets.chips}" alt="Hand-drawn pile of casino chips">
      </section>

      <div class="section-heading">
        <h2>Pick a game</h2>
        <span>${money(state.balance)} available</span>
      </div>

      <section class="game-grid" aria-label="Available games">
        ${Object.entries(gameMeta).map(([key, meta]) => `
          <button class="game-card" type="button" data-route="${key}">
            <img src="${meta.art}" alt="" aria-hidden="true">
            <strong>${meta.title}</strong>
            <small>${meta.text}</small>
          </button>`).join("")}
      </section>

      <section class="panel" style="margin-top: 24px;">
        <h2>How saving works</h2>
        <p class="note">Your balance, stats, and recent results are stored only in this browser with localStorage. There is no account, server, purchase, or real payout.</p>
      </section>`;
  }

  function renderSlots() {
    return `
      ${pageHead("slots", "Set a bet, spin three reels, and match the hand-drawn symbols.")}
      <div class="game-layout">
        <section class="panel">
          <div id="slot-reels" class="reels" aria-live="polite">
            <div class="reel">7</div>
            <div class="reel">BAR</div>
            <div class="reel">CHERRY</div>
          </div>
          <div id="slot-result" class="result-box">
            <div><strong>Ready</strong><p>Three matching symbols pay best.</p></div>
          </div>
        </section>
        <aside class="panel controls">
          <div class="field">
            <label for="slots-bet">Bet</label>
            <input id="slots-bet" type="number" inputmode="numeric" min="1" step="1" value="10">
          </div>
          ${quickBetButtons("slots-bet")}
          <button id="spin-slots" class="button primary" type="button">Spin</button>
          <div>
            <h3>Payouts</h3>
            <ul class="rule-list">
              <li>7 7 7 pays 15x</li>
              <li>BAR BAR BAR pays 8x</li>
              <li>Three cherries pay 6x</li>
              <li>Three stars pay 5x</li>
              <li>Any pair pays 2x</li>
            </ul>
          </div>
        </aside>
      </div>`;
  }

  function spinSlots() {
    if (busy) return;
    const bet = parseBet("slots-bet");
    if (bet === null) return;
    busy = true;
    chargeBet("slots", bet);

    const symbols = [
      { label: "7", weight: 5 },
      { label: "BAR", weight: 10 },
      { label: "CHERRY", weight: 16 },
      { label: "STAR", weight: 18 },
      { label: "LEMON", weight: 24 }
    ];
    const totalWeight = symbols.reduce((sum, item) => sum + item.weight, 0);
    const pick = () => {
      let ticket = randomInt(totalWeight);
      for (const symbol of symbols) {
        if (ticket < symbol.weight) return symbol.label;
        ticket -= symbol.weight;
      }
      return "LEMON";
    };

    const result = [pick(), pick(), pick()];
    const reels = document.querySelector("#slot-reels");
    reels.classList.add("spinning");

    setTimeout(() => {
      reels.classList.remove("spinning");
      reels.querySelectorAll(".reel").forEach((reel, index) => {
        reel.textContent = result[index];
      });

      let multiplier = 0;
      if (result.every(value => value === "7")) multiplier = 15;
      else if (result.every(value => value === "BAR")) multiplier = 8;
      else if (result.every(value => value === "CHERRY")) multiplier = 6;
      else if (result.every(value => value === "STAR")) multiplier = 5;
      else if (new Set(result).size === 2) multiplier = 2;

      const payout = bet * multiplier;
      settle("slots", bet, payout, result.join(" | "));
      document.querySelector("#slot-result").innerHTML = payout > 0
        ? `<div><strong>${money(payout)}</strong><p>${multiplier}x payout</p></div>`
        : `<div><strong>No match</strong><p>The reels took ${money(bet)}.</p></div>`;
      busy = false;
      updateWallet();
    }, 650);
  }

  function renderCoin() {
    return `
      ${pageHead("coin", "Pick heads or tails. A correct call returns 2x your bet.")}
      <div class="game-layout">
        <section class="panel">
          <div class="coin-stage">
            <div id="coin-token" class="coin-token" aria-live="polite">?</div>
          </div>
          <div id="coin-result" class="result-box">
            <div><strong>Call it</strong><p>Heads or tails.</p></div>
          </div>
        </section>
        <aside class="panel controls">
          <div class="field">
            <label for="coin-bet">Bet</label>
            <input id="coin-bet" type="number" inputmode="numeric" min="1" step="1" value="10">
          </div>
          ${quickBetButtons("coin-bet")}
          <div class="choice-row">
            <button class="button primary" type="button" data-coin-choice="Heads">Heads</button>
            <button class="button" type="button" data-coin-choice="Tails">Tails</button>
          </div>
          <p class="note">Each side has a 50% chance. Winning pays 2x total.</p>
        </aside>
      </div>`;
  }

  function flipCoin(choice) {
    if (busy) return;
    const bet = parseBet("coin-bet");
    if (bet === null) return;
    busy = true;
    chargeBet("coin", bet);
    const outcome = randomInt(2) === 0 ? "Heads" : "Tails";
    const coin = document.querySelector("#coin-token");
    coin.classList.add("flipping");
    coin.textContent = "";

    setTimeout(() => {
      const won = choice === outcome;
      const payout = won ? bet * 2 : 0;
      coin.classList.remove("flipping");
      coin.textContent = outcome;
      settle("coin", bet, payout, `${choice} called, ${outcome} landed`);
      document.querySelector("#coin-result").innerHTML = won
        ? `<div><strong>You called it</strong><p>${money(payout)} returned.</p></div>`
        : `<div><strong>${outcome}</strong><p>Your ${choice} call missed.</p></div>`;
      busy = false;
      updateWallet();
    }, 820);
  }

  const redNumbers = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

  function rouletteColor(number) {
    if (number === 0) return "green";
    return redNumbers.has(number) ? "red" : "black";
  }

  function renderRoulette() {
    return `
      ${pageHead("roulette", "European roulette with one zero. Choose one outside bet or a straight number.")}
      <div class="game-layout">
        <section class="panel">
          <div id="roulette-number" class="roulette-number" aria-live="polite">?</div>
          <div id="roulette-result" class="result-box">
            <div><strong>Place a bet</strong><p>The wheel contains 0 through 36.</p></div>
          </div>
        </section>
        <aside class="panel controls">
          <div class="field">
            <label for="roulette-bet">Bet</label>
            <input id="roulette-bet" type="number" inputmode="numeric" min="1" step="1" value="10">
          </div>
          ${quickBetButtons("roulette-bet")}
          <div class="field">
            <label for="roulette-type">Bet type</label>
            <select id="roulette-type">
              <option value="red">Red</option>
              <option value="black">Black</option>
              <option value="even">Even</option>
              <option value="odd">Odd</option>
              <option value="low">1 to 18</option>
              <option value="high">19 to 36</option>
              <option value="number">Single number</option>
            </select>
          </div>
          <div id="roulette-number-field" class="field" hidden>
            <label for="roulette-pick">Number, 0 to 36</label>
            <input id="roulette-pick" type="number" inputmode="numeric" min="0" max="36" step="1" value="7">
          </div>
          <button id="spin-roulette" class="button primary" type="button">Spin wheel</button>
          <p class="note">Outside bets return 2x. A correct single number returns 36x.</p>
        </aside>
      </div>`;
  }

  function toggleRouletteNumberField() {
    const type = document.querySelector("#roulette-type")?.value;
    const field = document.querySelector("#roulette-number-field");
    if (field) field.hidden = type !== "number";
  }

  function spinRoulette() {
    if (busy) return;
    const bet = parseBet("roulette-bet");
    if (bet === null) return;
    const type = document.querySelector("#roulette-type").value;
    let pick = null;
    if (type === "number") {
      pick = Number(document.querySelector("#roulette-pick").value);
      if (!Number.isInteger(pick) || pick < 0 || pick > 36) {
        showToast("Pick a whole number from 0 through 36.");
        return;
      }
    }

    busy = true;
    chargeBet("roulette", bet);
    const outcome = randomInt(37);
    const color = rouletteColor(outcome);
    const wheel = document.querySelector("#roulette-number");
    wheel.classList.add("spinning");
    wheel.textContent = "";

    setTimeout(() => {
      wheel.classList.remove("spinning");
      wheel.textContent = String(outcome);
      let won = false;
      let multiplier = 0;
      if (type === "red" || type === "black") won = color === type;
      if (type === "even") won = outcome !== 0 && outcome % 2 === 0;
      if (type === "odd") won = outcome % 2 === 1;
      if (type === "low") won = outcome >= 1 && outcome <= 18;
      if (type === "high") won = outcome >= 19 && outcome <= 36;
      if (type === "number") won = outcome === pick;
      if (won) multiplier = type === "number" ? 36 : 2;

      const payout = bet * multiplier;
      const pickedLabel = type === "number" ? `number ${pick}` : type;
      settle("roulette", bet, payout, `${pickedLabel}, landed ${outcome} ${color}`);
      document.querySelector("#roulette-result").innerHTML = won
        ? `<div><strong>${outcome} ${color}</strong><p>${money(payout)} returned.</p></div>`
        : `<div><strong>${outcome} ${color}</strong><p>Your ${pickedLabel} bet lost.</p></div>`;
      busy = false;
      updateWallet();
    }, 900);
  }

  function buildDeck() {
    const suits = ["♠", "♥", "♦", "♣"];
    const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
    return shuffle(suits.flatMap(suit => ranks.map(rank => ({ suit, rank }))));
  }

  function cardValue(card) {
    if (["J", "Q", "K"].includes(card.rank)) return 10;
    if (card.rank === "A") return 11;
    return Number(card.rank);
  }

  function handScore(hand) {
    let total = hand.reduce((sum, card) => sum + cardValue(card), 0);
    let aces = hand.filter(card => card.rank === "A").length;
    while (total > 21 && aces > 0) {
      total -= 10;
      aces -= 1;
    }
    return total;
  }

  function isBlackjack(hand) {
    return hand.length === 2 && handScore(hand) === 21;
  }

  function drawCard() {
    if (state.blackjack.deck.length < 15) state.blackjack.deck = buildDeck();
    return state.blackjack.deck.pop();
  }

  function cardHtml(card, hidden = false) {
    if (hidden) return `<div class="playing-card hidden"><span>SA</span></div>`;
    return `
      <div class="playing-card" aria-label="${card.rank} of ${card.suit}">
        <span>${card.rank}${card.suit}</span>
        <span class="center-suit">${card.suit}</span>
        <span style="align-self: end; transform: rotate(180deg);">${card.rank}${card.suit}</span>
      </div>`;
  }

  function renderBlackjack() {
    const bj = state.blackjack;
    const dealerVisible = bj.active ? [bj.dealer[0]] : bj.dealer;
    const dealerScore = bj.dealer.length ? (bj.active ? cardValue(bj.dealer[0]) : handScore(bj.dealer)) : 0;
    return `
      ${pageHead("blackjack", "Dealer stands on 17. Blackjack pays 3 to 2. Double down is available on the first two cards.")}
      <div class="game-layout">
        <section class="panel card-table">
          <div>
            <div class="hand-label"><strong>Dealer</strong><span>${dealerScore || ""}</span></div>
            <div class="playing-cards">
              ${dealerVisible.filter(Boolean).map(card => cardHtml(card)).join("")}
              ${bj.active && bj.dealer.length > 1 ? cardHtml(null, true) : ""}
            </div>
          </div>
          <div>
            <div class="hand-label"><strong>You</strong><span>${bj.player.length ? handScore(bj.player) : ""}</span></div>
            <div class="playing-cards">${bj.player.map(card => cardHtml(card)).join("")}</div>
          </div>
          <div class="result-box"><div><strong>${bj.message}</strong>${bj.active ? `<p>Current bet: ${money(bj.bet)}</p>` : ""}</div></div>
        </section>
        <aside class="panel controls">
          ${bj.active ? `
            <button id="blackjack-hit" class="button primary" type="button">Hit</button>
            <button id="blackjack-stand" class="button" type="button">Stand</button>
            <button id="blackjack-double" class="button" type="button" ${bj.player.length !== 2 || state.balance < bj.bet ? "disabled" : ""}>Double down</button>
          ` : `
            <div class="field">
              <label for="blackjack-bet">Bet</label>
              <input id="blackjack-bet" type="number" inputmode="numeric" min="1" step="1" value="25">
            </div>
            ${quickBetButtons("blackjack-bet")}
            <button id="blackjack-deal" class="button primary" type="button">Deal</button>
          `}
          <ul class="rule-list">
            <li>Dealer stands on all 17s</li>
            <li>Blackjack returns 2.5x total</li>
            <li>A push returns your bet</li>
            <li>No splits or insurance yet</li>
          </ul>
        </aside>
      </div>`;
  }

  function dealBlackjack() {
    if (busy || state.blackjack.active) return;
    const bet = parseBet("blackjack-bet");
    if (bet === null) return;
    chargeBet("blackjack", bet);
    state.blackjack = {
      active: true,
      bet,
      deck: state.blackjack.deck.length > 15 ? state.blackjack.deck : buildDeck(),
      player: [],
      dealer: [],
      doubled: false,
      message: "Your move."
    };
    state.blackjack.player.push(drawCard(), drawCard());
    state.blackjack.dealer.push(drawCard(), drawCard());

    const playerNatural = isBlackjack(state.blackjack.player);
    const dealerNatural = isBlackjack(state.blackjack.dealer);
    if (playerNatural || dealerNatural) {
      finishBlackjackNatural(playerNatural, dealerNatural);
      return;
    }
    saveState();
    render();
  }

  function finishBlackjackNatural(playerNatural, dealerNatural) {
    const bj = state.blackjack;
    let payout = 0;
    let message = "";
    let result = null;
    if (playerNatural && dealerNatural) {
      payout = bj.bet;
      message = "Both have blackjack. Push.";
      result = "push";
    } else if (playerNatural) {
      payout = bj.bet * 2.5;
      message = "Blackjack. Paid 3 to 2.";
      result = "win";
    } else {
      message = "Dealer blackjack.";
      result = "loss";
    }
    settle("blackjack", bj.bet, payout, message, result);
    state.blackjack.active = false;
    state.blackjack.message = message;
    saveState();
    render();
  }

  function blackjackHit() {
    const bj = state.blackjack;
    if (!bj.active || busy) return;
    bj.player.push(drawCard());
    const score = handScore(bj.player);
    if (score > 21) {
      settle("blackjack", bj.bet, 0, `Player busted with ${score}`);
      bj.active = false;
      bj.message = `Bust with ${score}.`;
    } else if (score === 21) {
      saveState();
      blackjackStand();
      return;
    } else {
      bj.message = "Hit or stand?";
    }
    saveState();
    render();
  }

  function blackjackDouble() {
    const bj = state.blackjack;
    if (!bj.active || bj.player.length !== 2 || state.balance < bj.bet || busy) return;
    const extra = bj.bet;
    chargeBet("blackjack", extra);
    bj.bet += extra;
    bj.doubled = true;
    bj.player.push(drawCard());
    if (handScore(bj.player) > 21) {
      settle("blackjack", bj.bet, 0, `Doubled and busted with ${handScore(bj.player)}`);
      bj.active = false;
      bj.message = `Bust with ${handScore(bj.player)}.`;
      saveState();
      render();
      return;
    }
    saveState();
    blackjackStand();
  }

  function blackjackStand() {
    const bj = state.blackjack;
    if (!bj.active || busy) return;
    busy = true;
    while (handScore(bj.dealer) < 17) bj.dealer.push(drawCard());
    const playerScore = handScore(bj.player);
    const dealerScore = handScore(bj.dealer);
    let payout = 0;
    let message = "";
    let result = null;

    if (dealerScore > 21) {
      payout = bj.bet * 2;
      message = `Dealer busts with ${dealerScore}. You win.`;
      result = "win";
    } else if (playerScore > dealerScore) {
      payout = bj.bet * 2;
      message = `${playerScore} beats ${dealerScore}. You win.`;
      result = "win";
    } else if (playerScore < dealerScore) {
      message = `${dealerScore} beats ${playerScore}. Dealer wins.`;
      result = "loss";
    } else {
      payout = bj.bet;
      message = `${playerScore} to ${dealerScore}. Push.`;
      result = "push";
    }

    settle("blackjack", bj.bet, payout, message, result);
    bj.active = false;
    bj.message = message;
    saveState();
    busy = false;
    render();
  }

  const horses = ["Ink Runner", "Paper Cut", "Lucky Scribble", "Fast Eraser", "Wonky Hoof"];

  function renderHorses() {
    return `
      ${pageHead("horses", "Every horse has the same one-in-five chance. A winning pick returns 5x.")}
      <div class="game-layout">
        <section class="panel">
          <div id="race-list" class="race-list" aria-live="polite">
            ${horses.map((horse, index) => `
              <div class="race-lane" data-horse-index="${index}">
                <strong>${index + 1}. ${horse}</strong>
                <div class="race-track"><span class="race-runner">♞</span></div>
              </div>`).join("")}
          </div>
          <div id="race-result" class="result-box" style="margin-top: 22px;">
            <div><strong>At the starting line</strong><p>Pick one runner.</p></div>
          </div>
        </section>
        <aside class="panel controls">
          <div class="field">
            <label for="horse-pick">Horse</label>
            <select id="horse-pick">
              ${horses.map((horse, index) => `<option value="${index}">${index + 1}. ${horse}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="horse-bet">Bet</label>
            <input id="horse-bet" type="number" inputmode="numeric" min="1" step="1" value="10">
          </div>
          ${quickBetButtons("horse-bet")}
          <button id="start-race" class="button primary" type="button">Start race</button>
          <p class="note">Equal odds. No hidden horse stats. Winning returns 5x total.</p>
        </aside>
      </div>`;
  }

  function startHorseRace() {
    if (busy) return;
    const bet = parseBet("horse-bet");
    if (bet === null) return;
    const pick = Number(document.querySelector("#horse-pick").value);
    if (!Number.isInteger(pick) || pick < 0 || pick >= horses.length) return;
    busy = true;
    chargeBet("horses", bet);
    const winner = randomInt(horses.length);
    const lanes = [...document.querySelectorAll(".race-lane")];
    document.querySelector("#race-result").innerHTML = `<div><strong>They are off</strong><p>${horses[pick]} has your ${money(bet)} bet.</p></div>`;

    requestAnimationFrame(() => {
      lanes.forEach((lane, index) => {
        const runner = lane.querySelector(".race-runner");
        const finish = index === winner ? 92 : 60 + randomInt(29);
        runner.style.left = `calc(${finish}% - 20px)`;
      });
    });

    setTimeout(() => {
      const won = pick === winner;
      const payout = won ? bet * 5 : 0;
      lanes[winner].classList.add("winner");
      settle("horses", bet, payout, `${horses[pick]} picked, ${horses[winner]} won`);
      document.querySelector("#race-result").innerHTML = won
        ? `<div><strong>${horses[winner]} wins</strong><p>${money(payout)} returned.</p></div>`
        : `<div><strong>${horses[winner]} wins</strong><p>${horses[pick]} did not get there.</p></div>`;
      busy = false;
      updateWallet();
    }, 1800);
  }

  function renderStats() {
    const net = state.returned - state.wagered;
    const totalPlays = Object.values(state.byGame).reduce((sum, game) => sum + game.plays, 0);
    const biggestWin = state.history.reduce((best, item) => Math.max(best, item.net), 0);
    return `
      <div class="page-head">
        <div>
          <h1 class="page-title">Stats</h1>
          <p class="page-intro">Everything below is stored locally in this browser.</p>
        </div>
        <img class="page-art" src="${assets.chips}" alt="Hand-drawn casino chips">
      </div>

      <section class="stat-grid">
        <div class="stat"><span>Current balance</span><strong>${money(state.balance)}</strong></div>
        <div class="stat"><span>Total wagered</span><strong>${money(state.wagered)}</strong></div>
        <div class="stat"><span>Net result</span><strong>${net >= 0 ? "+" : ""}${money(net)}</strong></div>
        <div class="stat"><span>Games settled</span><strong>${totalPlays}</strong></div>
        <div class="stat"><span>Wins</span><strong>${state.wins}</strong></div>
        <div class="stat"><span>Losses</span><strong>${state.losses}</strong></div>
        <div class="stat"><span>Pushes</span><strong>${state.pushes}</strong></div>
        <div class="stat"><span>Biggest win</span><strong>${money(biggestWin)}</strong></div>
      </section>

      <section class="panel" style="margin-top: 20px;">
        <div class="section-heading" style="margin-top: 0;">
          <h2>By game</h2>
        </div>
        <div class="stat-grid">
          ${Object.entries(state.byGame).map(([key, game]) => `
            <div class="stat">
              <span>${gameMeta[key].title}</span>
              <strong>${game.plays} plays</strong>
              <small>${money(game.returned - game.wagered)} net</small>
            </div>`).join("")}
        </div>
      </section>

      <section class="panel" style="margin-top: 20px;">
        <div class="section-heading" style="margin-top: 0;">
          <h2>Recent results</h2>
          <button id="reset-save" class="button" type="button">Reset everything</button>
        </div>
        ${state.history.length ? `
          <ul class="history-list">
            ${state.history.map(item => `
              <li>
                <strong>${gameMeta[item.game].title}</strong>
                <span>${escapeHtml(item.detail)}</span>
                <span class="${item.net >= 0 ? "positive" : "negative"}">${item.net >= 0 ? "+" : ""}${money(item.net)}</span>
              </li>`).join("")}
          </ul>` : `<div class="empty-state">No games settled yet.</div>`}
      </section>`;
  }

  function resetSave() {
    if (!confirm("Reset the balance, history, and all stats?")) return;
    state = createDefaultState();
    saveState();
    render();
    showToast("Fresh save created with $1,000.");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  document.addEventListener("click", event => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) {
      go(routeButton.dataset.route);
      return;
    }

    const setBet = event.target.closest("[data-set-bet], [data-set-max]");
    if (setBet) {
      const input = document.querySelector(`#${setBet.dataset.target}`);
      if (!input) return;
      input.value = setBet.hasAttribute("data-set-max") ? Math.floor(state.balance) : setBet.dataset.setBet;
      input.focus();
      return;
    }

    if (event.target.closest("#spin-slots")) spinSlots();
    if (event.target.closest("[data-coin-choice]")) flipCoin(event.target.closest("[data-coin-choice]").dataset.coinChoice);
    if (event.target.closest("#spin-roulette")) spinRoulette();
    if (event.target.closest("#blackjack-deal")) dealBlackjack();
    if (event.target.closest("#blackjack-hit")) blackjackHit();
    if (event.target.closest("#blackjack-stand")) blackjackStand();
    if (event.target.closest("#blackjack-double")) blackjackDouble();
    if (event.target.closest("#start-race")) startHorseRace();
    if (event.target.closest("#reset-save")) resetSave();
  });

  document.addEventListener("change", event => {
    if (event.target.matches("#roulette-type")) toggleRouletteNumberField();
  });

  window.addEventListener("hashchange", () => {
    if (busy) return;
    route = getInitialRoute();
    render();
  });

  render();
})();
