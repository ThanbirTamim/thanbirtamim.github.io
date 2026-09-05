/* ============================================================
   LUDO — networking layer (WebRTC via PeerJS)
   Host-authoritative star topology. Browsers connect directly
   (P2P DataChannels); PeerJS's free broker is used ONLY for
   signalling to establish the connection. No backend/database.
   ------------------------------------------------------------
   Clean abstraction (game logic never touches PeerJS directly):
     createRoom(), joinRoom(), sendAction(), broadcastState(),
     disconnect(), on(type, cb)
   Message types are tiny turn-based actions/events.
   ============================================================ */
(function (root) {
  "use strict";
  const CFG = root.LUDO_CONFIG;

  class LudoNet {
    constructor() {
      this.peer = null; this.isHost = false; this.roomCode = null; this.passcode = null;
      this.myId = null; this.hostId = null; this.conns = {};      // host: peerId -> conn
      this.hostConn = null;                                        // client: conn to host
      this.handlers = {}; this.maxPlayers = 4; this.closed = false;
      this.roster = [];                                            // authoritative on host
    }
    available() { return typeof root.Peer === "function"; }
    on(type, cb) { (this.handlers[type] || (this.handlers[type] = [])).push(cb); return this; }
    emit(type, data) { (this.handlers[type] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } }); (this.handlers["*"] || []).forEach((cb) => cb(type, data)); }

    genCode() { const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += A[(Math.random() * A.length) | 0]; return s; }

    // ---------------- HOST ----------------
    createRoom(opts) {
      if (!this.available()) { this.emit("error", { code: "no-peerjs", msg: "Networking unavailable. Check your connection." }); return; }
      this.isHost = true; this.maxPlayers = opts.max || 4; this.passcode = opts.passcode || null;
      this.roomCode = opts.code || this.genCode();
      const pid = CFG.NET.idPrefix + this.roomCode;
      this.peer = new root.Peer(pid, CFG.NET.peerConfig);
      this._openTimer = setTimeout(() => { if (!this.myId && !this.closed) this.emit("error", { code: "create-timeout", msg: "Couldn't reach the connection service. Check your internet and try again." }); }, CFG.NET.createTimeoutMs || 15000);
      this.peer.on("open", (id) => { clearTimeout(this._openTimer); this.myId = id; this.hostId = id; this.emit("room-created", { code: this.roomCode, id }); });
      this.peer.on("connection", (conn) => this._hostOnConn(conn));
      this.peer.on("error", (e) => { const code = (e && e.type) || "peer-error"; if (code === "unavailable-id") this.emit("error", { code: "code-taken", msg: "That room code is busy — try creating again." }); else this.emit("error", { code, msg: "Network error: " + code }); });
      this.peer.on("disconnected", () => { if (!this.closed) try { this.peer.reconnect(); } catch (e) {} });
    }
    _hostOnConn(conn) {
      conn.on("open", () => { this.conns[conn.peer] = conn; });
      conn.on("data", (msg) => this._hostHandle(conn, msg));
      conn.on("close", () => { delete this.conns[conn.peer]; this.emit("peer-left", { peerId: conn.peer }); });
      conn.on("error", () => {});
    }
    _hostHandle(conn, msg) {
      if (msg.t === "join") {
        if (this.passcode && String(msg.pass || "") !== String(this.passcode)) { conn.send({ t: "join-reject", reason: "passcode" }); return; }
        const connectedCount = this.roster.filter((r) => r.connected).length;
        // reconnect: same requested playerId still in roster
        const existing = msg.rejoinId && this.roster.find((r) => r.pid === msg.rejoinId);
        if (existing) { existing.peerId = conn.peer; existing.connected = true; conn.send({ t: "welcome", you: existing.pid, roster: this.roster, code: this.roomCode, started: this.started }); this._broadcastRoster(); this.emit("peer-rejoined", { pid: existing.pid }); if (this.started && this.lastState) conn.send({ t: "state", state: this.lastState }); return; }
        if (this.started) { conn.send({ t: "join-reject", reason: "started" }); return; }
        if (this.roster.length >= this.maxPlayers) { conn.send({ t: "join-reject", reason: "full" }); return; }
        const pid = "P" + (this.roster.length + 1) + "-" + Math.random().toString(36).slice(2, 6);
        const entry = { pid, peerId: conn.peer, name: (msg.name || "Player").slice(0, 14), connected: true };
        this.roster.push(entry);
        conn.send({ t: "welcome", you: pid, roster: this.roster, code: this.roomCode, started: false });
        this._broadcastRoster(); this.emit("peer-joined", { entry });
      } else if (msg.t === "action") { this.emit("action", { from: conn.peer, action: msg.action }); }
      else if (msg.t === "leave") { const e = this.roster.find((r) => r.peerId === conn.peer); if (e) e.connected = false; this._broadcastRoster(); this.emit("peer-left", { peerId: conn.peer }); }
    }
    _broadcastRoster() { this.emit("roster", { roster: this.roster }); this._send({ t: "roster", roster: this.roster }); }
    _send(obj) { for (const id in this.conns) { try { this.conns[id].send(obj); } catch (e) {} } }

    // host: register the local host player into roster
    registerSelf(name) { const pid = "HOST"; this.roster.unshift({ pid, peerId: this.myId, name: (name || "Host").slice(0, 14), connected: true, host: true }); this.emit("roster", { roster: this.roster }); return pid; }
    startGame(payload) { this.started = true; this._send({ t: "start", payload }); }
    broadcastState(state, event) { this.lastState = state; this._send({ t: "state", state, event }); }

    // ---------------- CLIENT ----------------
    joinRoom(opts) {
      if (!this.available()) { this.emit("error", { code: "no-peerjs", msg: "Networking unavailable. Check your connection." }); return; }
      this.isHost = false; this.roomCode = (opts.code || "").toUpperCase(); this._name = opts.name; this._pass = opts.pass; this._rejoinId = opts.rejoinId || null;
      this.hostId = CFG.NET.idPrefix + this.roomCode;
      this.peer = new root.Peer(CFG.NET.peerConfig);
      this.peer.on("open", (id) => { this.myId = id; this._connectHost(); });
      this.peer.on("error", (e) => { const code = (e && e.type) || "peer-error"; if (code === "peer-unavailable") this.emit("error", { code: "not-found", msg: "Room not found. Check the code." }); else this.emit("error", { code, msg: "Connection failed: " + code }); });
      this.peer.on("disconnected", () => { if (!this.closed) try { this.peer.reconnect(); } catch (e) {} });
    }
    _connectHost() {
      const conn = this.peer.connect(this.hostId, { reliable: true }); this.hostConn = conn;
      const timeout = setTimeout(() => { if (!this._welcomed) this.emit("error", { code: "timeout", msg: "Could not reach the room. Make sure the host's screen is open on the lobby, check the code, and try again." }); }, CFG.NET.joinTimeoutMs || 15000);
      conn.on("open", () => { conn.send({ t: "join", name: this._name, pass: this._pass, rejoinId: this._rejoinId }); });
      conn.on("data", (msg) => { clearTimeout(timeout); this._clientHandle(msg); });
      conn.on("close", () => { this.emit("host-lost", {}); });
      conn.on("error", () => this.emit("error", { code: "conn", msg: "Connection error." }));
    }
    _clientHandle(msg) {
      if (msg.t === "welcome") { this._welcomed = true; this.myPid = msg.you; this.roster = msg.roster; this.emit("welcome", msg); }
      else if (msg.t === "join-reject") { const m = { full: "This room already has the maximum players.", started: "The game has already started.", passcode: "Wrong passcode." }[msg.reason] || "Could not join."; this.emit("error", { code: "reject-" + msg.reason, msg: m }); }
      else if (msg.t === "roster") { this.roster = msg.roster; this.emit("roster", { roster: msg.roster }); }
      else if (msg.t === "start") { this.emit("start", msg.payload); }
      else if (msg.t === "state") { this.emit("state", { state: msg.state, event: msg.event }); }
    }
    // client -> host
    sendAction(action) { if (this.hostConn && this.hostConn.open) { try { this.hostConn.send({ t: "action", action }); } catch (e) {} } }

    disconnect() { this.closed = true; try { if (this.hostConn) this.hostConn.send({ t: "leave" }); } catch (e) {} try { this.peer && this.peer.destroy(); } catch (e) {} this.peer = null; this.conns = {}; this.hostConn = null; this.emit("closed", {}); }
  }

  root.LudoNet = LudoNet;
})(typeof window !== "undefined" ? window : globalThis);
