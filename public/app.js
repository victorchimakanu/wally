(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var chat         = $("chat");
  var inputEl      = $("input");
  var sendBtn      = $("send");
  var balanceTrack = $("balance-track");
  var overlay      = $("overlay");
  var holoBody     = $("holo-body");
  var holoTimeout  = $("holo-timeout");
  var holoFill     = $("holo-progress-fill");
  var btnConfirm   = $("btn-confirm");
  var btnCancel    = $("btn-cancel");
  var signalLost   = $("signal-lost");
  var sessionList  = $("session-list");   // optional: sidebar (skin-dependent)
  var newChatBtn   = $("new-chat");       // optional: sidebar (skin-dependent)

  var ws               = null;
  var networkMode      = "testnet";
  var pendingToken     = null;
  var countdownTimer   = null;
  var reconnectTimer   = null;
  var reconnectDelay   = 1000;
  var typingEl         = null;
  var addrTimers       = {};
  var welcomed         = false;
  var welcomeTimer     = null;
  var currentSessionId = null;

  // USDT-first: Arbitrum leads (gasless USDT is Wally's default story).
  var CHAINS = [
    { key: "arbitrum", cls: "arb", name: "ARBITRUM" },
    { key: "ethereum", cls: "eth", name: "ETHEREUM" },
    { key: "bitcoin",  cls: "btc", name: "BITCOIN"  }
  ];

  function esc(v) {
    return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* Session identity lives in a server-issued HttpOnly cookie; this script
     can neither read nor write it. Switching sessions goes through the API. */

  /* ── WebSocket ──────────────────────────────────────────────── */

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(proto + "//" + location.host + "/ws");

    ws.onopen = function () {
      clearTimeout(reconnectTimer);
      reconnectDelay = 1000;
      signalLost.hidden = true;
    };

    ws.onmessage = function (evt) {
      var event;
      try { event = JSON.parse(evt.data); } catch (e) { return; }
      handleServerEvent(event);
    };

    ws.onclose = function () {
      scheduleReconnect();
    };

    ws.onerror = function () { ws.close(); };
  }

  function wsOpen() {
    return ws && ws.readyState === WebSocket.OPEN;
  }

  function send(obj) {
    if (!wsOpen()) return;
    ws.send(JSON.stringify(obj));
  }

  function scheduleReconnect() {
    signalLost.hidden = false;
    reconnectTimer = setTimeout(function () {
      connect();
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }, reconnectDelay);
  }

  /* ── Server event router ────────────────────────────────────── */

  function handleServerEvent(event) {
    if (event.type !== "typing") hideTyping();

    switch (event.type) {

      case "connected":
        networkMode = event.networkMode || "testnet";
        send({ type: "get_balance" });
        loadSessions();
        // Hold the welcome briefly: if a history replay follows, this is a
        // resumed chat and the welcome would be noise.
        clearTimeout(welcomeTimer);
        welcomeTimer = setTimeout(showWelcome, 200);
        break;

      case "history":
        clearTimeout(welcomeTimer);
        welcomed = true;
        // Replay only into an empty chat — a reconnect would duplicate
        // messages that are already on screen.
        if (!chat.querySelector(".message")) {
          renderHistory(event.messages || []);
        }
        break;

      case "typing":
        showTyping();
        break;

      case "message":
        addWallyMessage(event.content, false);
        loadSessions(); // a fresh chat earns its sidebar title after the first reply
        break;

      case "error":
        addWallyMessage(event.message, true);
        break;

      case "balance":
        renderBalances(event.balances || []);
        break;

      case "address":
        showAddressOnTile(event.chain, event.address);
        break;

      case "confirmation":
        openConfirmation(event.payload);
        break;

      case "tx_complete":
        // The server already sent the chat message with the explorer link;
        // just refresh balances once the chain has settled.
        setTimeout(function () { send({ type: "get_balance" }); }, 3000);
        break;
    }
  }

  /* ── Chat sessions sidebar (optional per skin) ──────────────── */

  function loadSessions() {
    if (!sessionList) return;
    fetch("/api/sessions")
      .then(function (r) { return r.json(); })
      .then(function (data) { renderSessions(data.sessions || [], data.activeId || null); })
      .catch(function () { /* sidebar is decorative; never break chat */ });
  }

  function renderSessions(items, activeId) {
    if (!sessionList) return;
    sessionList.textContent = "";
    (items || []).forEach(function (s) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "session-item" + (s.id === activeId ? " session-item--active" : "");
      btn.textContent = s.title;
      btn.title = s.title;
      btn.addEventListener("click", function () {
        fetch("/api/session/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: s.id }),
        }).then(function () { location.reload(); });
      });
      sessionList.appendChild(btn);
    });
  }

  if (newChatBtn) {
    newChatBtn.addEventListener("click", function () {
      fetch("/api/session/new", { method: "POST" })
        .then(function () { location.reload(); });
    });
  }

  /* ── History replay (resumed sessions) ──────────────────────── */

  function renderHistory(messages) {
    messages.forEach(function (m) {
      if (m.role === "user") addUserMessage(m.content);
      else if (m.role === "assistant") addWallyMessage(m.content, false);
    });
  }

  /* ── Welcome ────────────────────────────────────────────────── */

  function showWelcome() {
    if (welcomed) return;
    welcomed = true;
    var netLine = networkMode === "mainnet"
      ? "You are on MAINNET. Transactions move real funds."
      : "You are on TESTNET. Funds here are test tokens with no real value.";
    addWallyMessage(
      "Systems online. I am Wally, your agentic finance unit.\n" +
      "All inference runs on this device through QVAC. No cloud, no API keys.\n" +
      netLine + "\n\n" +
      "Try:\n" +
      "what is my balance\n" +
      "send 10 USDT to 0x... on arbitrum\n" +
      "what is my arbitrum address\n\n" +
      "Click any balance tile to reveal its wallet address.",
      false
    );
  }

  /* ── Balance strip ──────────────────────────────────────────── */

  function renderBalances(balances) {
    var byChain = {};
    balances.forEach(function (b) {
      if (!byChain[b.chain]) byChain[b.chain] = {};
      byChain[b.chain][b.token] = b.amount;
    });

    var eth = byChain["ethereum"] || {};
    var arb = byChain["arbitrum"] || {};
    var btc = byChain["bitcoin"]  || {};

    // USDT is the headline number on both EVM chains; ETH is a footnote.
    balanceTrack.innerHTML =
      buildTile(CHAINS[0], amt(arb["USDT"]),   "USDT", subLine(amt(arb["native"]), "ETH")) +
      buildTile(CHAINS[1], amt(eth["USDT"]),   "USDT", subLine(amt(eth["native"]), "ETH")) +
      buildTile(CHAINS[2], amt(btc["native"]), "BTC",  "");

    CHAINS.forEach(function (c) {
      var tile = balanceTrack.querySelector('[data-chain="' + c.key + '"]');
      if (!tile) return;
      tile.addEventListener("click", function () { toggleAddress(c); });
    });
  }

  function buildTile(c, primary, primaryTok, sub) {
    primary = esc(primary); primaryTok = esc(primaryTok);
    return '<div class="tile" data-chain="' + esc(c.key) + '" data-clickable ' +
      'title="Click to reveal wallet address">' +
      '<div class="tile__top">' +
        '<span class="tile__id"><span class="tile__chip tile__chip--' + c.cls + '"></span>' + c.name + '</span>' +
        '<span class="tile__net tile__net--' + esc(networkMode) + '">' + esc(networkMode.toUpperCase()) + '</span>' +
      '</div>' +
      '<div class="tile__bal" id="bal-' + c.cls + '">' +
        '<div class="tile__row">' +
          '<span class="tile__amt">' + (primary === null ? "—" : primary) + '</span>' +
          '<span class="tile__tok">' + primaryTok + '</span>' +
        '</div>' +
        '<div class="tile__sub">' + esc(sub) + '</div>' +
      '</div>' +
      '<div class="tile__addr" id="addr-' + c.cls + '" hidden></div>' +
    '</div>';
  }

  function subLine(amount, tok) {
    return amount === null ? "" : amount + " " + tok;
  }

  // amt cleans one balance value; the server normalizes, this is a fallback.
  function amt(raw) {
    if (raw === undefined || raw === null) return null;
    var str = String(raw).trim()
      .replace(/^balance:\s*/i, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    if (/^error/i.test(str)) return null;
    var wei = str.match(/^([\d,.]+)\s*wei$/i);
    if (wei) return trimNum(Number(wei[1].replace(/,/g, "")) / 1e18);
    var sats = str.match(/^([\d,.]+)\s*(?:satoshis?|sats?)$/i);
    if (sats) return trimNum(Number(sats[1].replace(/,/g, "")) / 1e8);
    var m = str.match(/^([\d,.]+)(?:\s+[A-Za-z]+)?$/);
    if (m) return m[1];
    return null;
  }

  function trimNum(n) {
    if (!isFinite(n)) return "0";
    return n.toFixed(8).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  /* Address reveal: click swaps balance → address; click again (or 15s) swaps back */

  function toggleAddress(c) {
    var addrEl = $("addr-" + c.cls);
    if (!addrEl) return;
    if (!addrEl.hidden) {
      hideAddress(c.cls, c.key);
      return;
    }
    send({ type: "get_address", chain: c.key });
  }

  function showAddressOnTile(chain, address) {
    var c = null;
    CHAINS.forEach(function (x) { if (x.key === chain) c = x; });
    if (!c) return;
    var balEl  = $("bal-" + c.cls);
    var addrEl = $("addr-" + c.cls);
    if (!balEl || !addrEl) return;

    addrEl.textContent = "";

    var text = document.createElement("span");
    text.className = "tile__addr-text";
    text.textContent = address;

    var btn = document.createElement("button");
    btn.className = "tile__copy";
    btn.type = "button";
    btn.textContent = "copy";
    btn.setAttribute("aria-label", "Copy wallet address");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      copyText(address, btn);
      // keep the address visible a while longer after a copy
      clearTimeout(addrTimers[chain]);
      addrTimers[chain] = setTimeout(function () { hideAddress(c.cls, chain); }, 15000);
    });

    addrEl.appendChild(text);
    addrEl.appendChild(btn);
    balEl.hidden  = true;
    addrEl.hidden = false;

    clearTimeout(addrTimers[chain]);
    addrTimers[chain] = setTimeout(function () { hideAddress(c.cls, chain); }, 15000);
  }

  function copyText(value, btn) {
    function done(ok) {
      btn.textContent = ok ? "copied" : "copy failed";
      btn.classList.add("tile__copy--done");
      setTimeout(function () {
        btn.textContent = "copy";
        btn.classList.remove("tile__copy--done");
      }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { done(true); }, function () { done(false); });
    } else {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { /* ignore */ }
      ta.remove();
      done(ok);
    }
  }

  function hideAddress(cls, chain) {
    clearTimeout(addrTimers[chain]);
    var balEl  = $("bal-" + cls);
    var addrEl = $("addr-" + cls);
    if (balEl)  balEl.hidden  = false;
    if (addrEl) addrEl.hidden = true;
  }

  /* ── Chat ───────────────────────────────────────────────────── */

  function scrollChat() { chat.scrollTop = chat.scrollHeight; }

  function addUserMessage(text) {
    chat.classList.remove("chat--empty");
    var el         = document.createElement("div");
    el.className   = "message user";
    el.textContent = text;
    chat.appendChild(el);
    scrollChat();
  }

  function addWallyMessage(text, isError) {
    chat.classList.remove("chat--empty");
    var el       = document.createElement("div");
    el.className = "message wally" + (isError ? " error" : "");

    var label = document.createElement("div");
    label.className   = "message__label";
    label.textContent = isError ? "ERROR" : "WALLY";

    var body = document.createElement("div");
    appendRichText(body, text);

    el.appendChild(label);
    el.appendChild(body);
    chat.appendChild(el);
    scrollChat();
  }

  // Build message content with DOM nodes only — model output never touches
  // innerHTML. Links are created via createElement with a validated URL.
  function appendRichText(parent, text) {
    var lines = String(text).split("\n");
    lines.forEach(function (line, li) {
      if (li > 0) parent.appendChild(document.createElement("br"));
      var rest = line;
      var re = /(https?:\/\/[^\s]+)/;
      var m;
      while ((m = rest.match(re))) {
        var before = rest.slice(0, m.index);
        if (before) parent.appendChild(document.createTextNode(before));
        var url = null;
        try { url = new URL(m[1]); } catch (e) { url = null; }
        if (url && (url.protocol === "https:" || url.protocol === "http:")) {
          var a = document.createElement("a");
          a.href = url.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = m[1];
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(m[1]));
        }
        rest = rest.slice(m.index + m[1].length);
      }
      if (rest) parent.appendChild(document.createTextNode(rest));
    });
  }

  function showTyping() {
    if (typingEl) return;
    typingEl = document.createElement("div");
    typingEl.className = "message wally";
    typingEl.innerHTML =
      '<div class="message__label">WALLY</div>' +
      '<div class="typing-row">' +
        '<span class="typing-sq"></span>' +
        '<span class="typing-sq"></span>' +
        '<span class="typing-sq"></span>' +
      '</div>';
    chat.appendChild(typingEl);
    scrollChat();
  }

  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  /* ── Composer ───────────────────────────────────────────────── */

  function submitMessage() {
    var text = inputEl.value.trim();
    if (!text) return;

    if (!wsOpen()) {
      addWallyMessage("Not connected. Reconnecting to the device link — try again in a moment.", true);
      return;
    }

    addUserMessage(text);
    send({ type: "message", content: text });
    inputEl.value = "";
    inputEl.style.height = "auto";
  }

  sendBtn.addEventListener("click", submitMessage);

  inputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitMessage();
    }
  });

  inputEl.addEventListener("input", function () {
    inputEl.style.height = "auto";
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
  });

  // Suggestion chips (skins may ship .chip[data-fill] buttons in the empty state)
  document.addEventListener("click", function (e) {
    var chip = e.target.closest ? e.target.closest(".chip[data-fill]") : null;
    if (!chip) return;
    inputEl.value = chip.getAttribute("data-fill");
    inputEl.dispatchEvent(new Event("input"));
    inputEl.focus();
  });

  /* ── Confirmation overlay ───────────────────────────────────── */

  function openConfirmation(payload) {
    pendingToken = payload.token;

    holoBody.textContent = "";
    [
      ["Action",   payload.action, false],
      ["Amount",   payload.amount + " " + payload.token_symbol, false],
      ["To",       payload.recipient, true],
      ["Chain",    capitalize(payload.chain), false],
      ["Est. fee", payload.fee, false],
    ].forEach(function (r) {
      var rowEl = document.createElement("div");
      rowEl.className = "holo-row";
      var labelEl = document.createElement("span");
      labelEl.className = "holo-row__label";
      labelEl.textContent = r[0];
      var valueEl = document.createElement("span");
      valueEl.className = "holo-row__value" + (r[2] ? " addr" : "");
      valueEl.textContent = r[1];
      rowEl.appendChild(labelEl);
      rowEl.appendChild(valueEl);
      holoBody.appendChild(rowEl);
    });

    overlay.hidden = false;
    startCountdown(60);
    // Confirming a spend requires a deliberate click. Focus rests on Cancel
    // so a stray Enter can never sign.
    btnCancel.focus();
  }


  function closeConfirmation() {
    clearInterval(countdownTimer);
    overlay.hidden = true;
    pendingToken = null;
    inputEl.focus();
  }

  function startCountdown(seconds) {
    var remaining = seconds;
    tick();
    clearInterval(countdownTimer);
    countdownTimer = setInterval(function () {
      remaining--;
      tick();
      if (remaining <= 0) {
        // The server's own 60s timeout cancels the operation and posts
        // "Transfer cancelled." — just close the overlay here.
        var token = pendingToken;
        closeConfirmation();
        if (token) send({ type: "cancel", token: token });
      }
    }, 1000);

    function tick() {
      holoTimeout.textContent = String(remaining);
      holoTimeout.classList.toggle("critical", remaining <= 10);
      holoFill.style.width = Math.max(0, (remaining / seconds) * 100) + "%";
    }
  }

  btnConfirm.addEventListener("click", function () {
    if (!pendingToken) return;
    send({ type: "confirm", token: pendingToken });
    closeConfirmation();
  });

  btnCancel.addEventListener("click", function () {
    if (!pendingToken) return;
    send({ type: "cancel", token: pendingToken });
    closeConfirmation();
  });

  /* ── Keyboard ───────────────────────────────────────────────── */

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !overlay.hidden) {
      btnCancel.click();
    }
    if (e.key === "Enter" && !overlay.hidden) {
      // Enter never confirms a spend. Click the button.
      e.preventDefault();
    }
  });

  /* ── Helpers ────────────────────────────────────────────────── */

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* ── First-run recovery phrase backup ──────────────────────── */

  function checkRecoveryBackup() {
    fetch("/api/wallet/recovery")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.pendingBackup && data.phrase) showRecoveryModal(data.phrase);
      })
      .catch(function () { /* no auto-wallet; nothing to back up */ });
  }

  function showRecoveryModal(phrase) {
    var back = document.createElement("div");
    back.className = "recovery-backdrop";

    var card = document.createElement("div");
    card.className = "recovery-card";

    var h = document.createElement("h2");
    h.textContent = "Your new wallet";
    var p = document.createElement("p");
    p.textContent =
      "Wally created a wallet just for you. Write down this recovery phrase and keep it somewhere safe. " +
      "It is the only way to recover your wallet. Anyone who has it controls your funds. Wally never sends it anywhere.";

    var box = document.createElement("div");
    box.className = "recovery-phrase";
    phrase.split(" ").forEach(function (word, i) {
      var w = document.createElement("span");
      w.className = "recovery-word";
      w.textContent = (i + 1) + ". " + word;
      box.appendChild(w);
    });

    var label = document.createElement("label");
    label.className = "recovery-ack";
    var chk = document.createElement("input");
    chk.type = "checkbox";
    var span = document.createElement("span");
    span.textContent = "I have written down my recovery phrase and stored it safely.";
    label.appendChild(chk);
    label.appendChild(span);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "recovery-btn";
    btn.textContent = "Continue to my wallet";
    btn.disabled = true;
    chk.addEventListener("change", function () { btn.disabled = !chk.checked; });
    btn.addEventListener("click", function () {
      fetch("/api/wallet/recovery/ack", { method: "POST" })
        .then(function () { back.remove(); })
        .catch(function () { back.remove(); });
    });

    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(box);
    card.appendChild(label);
    card.appendChild(btn);
    back.appendChild(card);
    document.body.appendChild(back);
  }

  /* ── Init ───────────────────────────────────────────────────── */

  connect();
  checkRecoveryBackup();
  inputEl.focus();

})();
