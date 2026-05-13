import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@pondwader/socks5-server/dist/index.js
var require_dist = __commonJS({
  "node_modules/@pondwader/socks5-server/dist/index.js"(exports, module) {
    "use strict";
    var __create2 = Object.create;
    var __defProp2 = Object.defineProperty;
    var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __getProtoOf2 = Object.getPrototypeOf;
    var __hasOwnProp2 = Object.prototype.hasOwnProperty;
    var __export2 = (target, all) => {
      for (var name in all)
        __defProp2(target, name, { get: all[name], enumerable: true });
    };
    var __copyProps2 = (to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp2(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    };
    var __toESM2 = (mod, isNodeMode, target) => (target = mod != null ? __create2(__getProtoOf2(mod)) : {}, __copyProps2(
      // If the importer is in node compatibility mode or this is not an ESM
      // file that has been converted to a CommonJS file using a Babel-
      // compatible transform (i.e. "__esModule" has not been set), then set
      // "default" to the CommonJS "module.exports" for node compatibility.
      isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: true }) : target,
      mod
    ));
    var __toCommonJS = (mod) => __copyProps2(__defProp2({}, "__esModule", { value: true }), mod);
    var src_exports = {};
    __export2(src_exports, {
      Socks5Server: () => Socks5Server,
      createServer: () => createServer3,
      defaultConnectionHandler: () => connectionHandler_default
    });
    module.exports = __toCommonJS(src_exports);
    var import_net2 = __toESM2(__require("net"));
    var Socks5ConnectionCommand = /* @__PURE__ */ ((Socks5ConnectionCommand2) => {
      Socks5ConnectionCommand2[Socks5ConnectionCommand2["connect"] = 1] = "connect";
      Socks5ConnectionCommand2[Socks5ConnectionCommand2["bind"] = 2] = "bind";
      Socks5ConnectionCommand2[Socks5ConnectionCommand2["udp"] = 3] = "udp";
      return Socks5ConnectionCommand2;
    })(Socks5ConnectionCommand || {});
    var Socks5ConnectionStatus = /* @__PURE__ */ ((Socks5ConnectionStatus2) => {
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["REQUEST_GRANTED"] = 0] = "REQUEST_GRANTED";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["GENERAL_FAILURE"] = 1] = "GENERAL_FAILURE";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["CONNECTION_NOT_ALLOWED"] = 2] = "CONNECTION_NOT_ALLOWED";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["NETWORK_UNREACHABLE"] = 3] = "NETWORK_UNREACHABLE";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["HOST_UNREACHABLE"] = 4] = "HOST_UNREACHABLE";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["CONNECTION_REFUSED"] = 5] = "CONNECTION_REFUSED";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["TTL_EXPIRED"] = 6] = "TTL_EXPIRED";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["COMMAND_NOT_SUPPORTED"] = 7] = "COMMAND_NOT_SUPPORTED";
      Socks5ConnectionStatus2[Socks5ConnectionStatus2["ADDRESS_TYPE_NOT_SUPPORTED"] = 8] = "ADDRESS_TYPE_NOT_SUPPORTED";
      return Socks5ConnectionStatus2;
    })(Socks5ConnectionStatus || {});
    var Socks5Connection = class {
      constructor(server, socket) {
        this.errorHandler = () => {
        };
        this.metadata = {};
        this.socket = socket;
        this.server = server;
        socket.on("error", this.errorHandler);
        socket.pause();
        this.handleGreeting();
      }
      readBytes(len) {
        return new Promise((resolve5) => {
          let buf = Buffer.allocUnsafe(len);
          let offset = 0;
          const dataListener = (chunk) => {
            const readAmount = Math.min(chunk.length, len - offset);
            chunk.copy(buf, offset, 0, readAmount);
            offset += readAmount;
            if (offset < len) return;
            this.socket.removeListener("data", dataListener);
            this.socket.push(chunk.subarray(readAmount));
            resolve5(buf);
            this.socket.pause();
          };
          this.socket.on("data", dataListener);
          this.socket.resume();
        });
      }
      async handleGreeting() {
        const ver = (await this.readBytes(1)).readUInt8();
        if (ver !== 5) return this.socket.destroy();
        const authMethodsAmount = (await this.readBytes(1)).readUInt8();
        if (authMethodsAmount > 128 || authMethodsAmount === 0) return this.socket.destroy();
        const authMethods = await this.readBytes(authMethodsAmount);
        const authMethodByteCode = this.server.authHandler ? 2 : 0;
        if (!authMethods.includes(authMethodByteCode)) {
          this.socket.write(Buffer.from([
            5,
            // Version 5 - Socks5
            255
            // no acceptable auth modes were offered 
          ]));
          return this.socket.destroy();
        }
        this.socket.write(Buffer.from([
          5,
          // Version 5 - Socks5
          authMethodByteCode
          // The chosen auth method, 0x00 for no auth, 0x02 for user-pass
        ]));
        if (this.server.authHandler) this.handleUserPassword();
        else this.handleConnectionRequest();
      }
      async handleUserPassword() {
        await this.readBytes(1);
        const usernameLength = (await this.readBytes(1)).readUint8();
        const username = (await this.readBytes(usernameLength)).toString();
        const passwordLength = (await this.readBytes(1)).readUint8();
        const password = (await this.readBytes(passwordLength)).toString();
        this.username = username;
        this.password = password;
        let calledBack = false;
        const acceptCallback = () => {
          if (calledBack) return;
          calledBack = true;
          this.socket.write(Buffer.from([
            1,
            // User pass auth version
            0
            // Success
          ]));
          this.handleConnectionRequest();
        };
        const denyCallback = () => {
          if (calledBack) return;
          calledBack = true;
          this.socket.write(Buffer.from([
            1,
            // User pass auth version
            1
            // Failure
          ]));
          this.socket.destroy();
        };
        const resp = await this.server.authHandler(this, acceptCallback, denyCallback);
        if (resp === true) acceptCallback();
        else if (resp === false) denyCallback();
      }
      async handleConnectionRequest() {
        await this.readBytes(1);
        const commandByte = (await this.readBytes(1))[0];
        const command = Socks5ConnectionCommand[commandByte];
        if (!command) return this.socket.destroy();
        this.command = command;
        await this.readBytes(1);
        const addrType = (await this.readBytes(1)).readUInt8();
        let address = "";
        switch (addrType) {
          case 1:
            address = (await this.readBytes(4)).join(".");
            break;
          case 3:
            const hostLength = (await this.readBytes(1)).readUInt8();
            address = (await this.readBytes(hostLength)).toString();
            break;
          case 4:
            const bytes = await this.readBytes(16);
            for (let i = 0; i < 16; i++) {
              if (i % 2 === 0 && i > 0) address += ":";
              address += `${bytes[i] < 16 ? "0" : ""}${bytes[i].toString(16)}`;
            }
            break;
          default:
            this.socket.destroy();
            return;
        }
        const port = (await this.readBytes(2)).readUInt16BE();
        if (!this.server.supportedCommands.has(command)) {
          this.socket.write(Buffer.from([
            5,
            7
            /* COMMAND_NOT_SUPPORTED */
          ]));
          return this.socket.destroy();
        }
        this.destAddress = address;
        this.destPort = port;
        let calledBack = false;
        const acceptCallback = () => {
          if (calledBack) return;
          calledBack = true;
          this.connect();
        };
        if (!this.server.rulesetValidator) return acceptCallback();
        const denyCallback = () => {
          if (calledBack) return;
          calledBack = true;
          this.socket.write(Buffer.from([
            5,
            2,
            // connection not allowed by ruleset
            0,
            1,
            0,
            0,
            0,
            0,
            0,
            0
          ]));
          this.socket.destroy();
        };
        const resp = await this.server.rulesetValidator(this, acceptCallback, denyCallback);
        if (resp === true) acceptCallback();
        else if (resp === false) denyCallback();
      }
      connect() {
        this.socket.removeListener("error", this.errorHandler);
        this.server.connectionHandler(this, (status) => {
          if (Socks5ConnectionStatus[status] === void 0) throw new Error(`"${status}" is not a valid status.`);
          this.socket.write(Buffer.from([
            5,
            Socks5ConnectionStatus[status],
            0,
            1,
            0,
            0,
            0,
            0,
            0,
            0
          ]));
          if (status !== "REQUEST_GRANTED") {
            this.socket.destroy();
          }
        });
        this.socket.resume();
      }
    };
    var import_net = __toESM2(__require("net"));
    function connectionHandler_default(connection, sendStatus) {
      if (connection.command !== "connect") return sendStatus("COMMAND_NOT_SUPPORTED");
      connection.socket.on("error", () => {
      });
      const stream = import_net.default.createConnection({
        host: connection.destAddress,
        port: connection.destPort
      });
      stream.setNoDelay();
      let streamOpened = false;
      stream.on("error", (err) => {
        if (!streamOpened) {
          switch (err.code) {
            case "EINVAL":
            case "ENOENT":
            case "ENOTFOUND":
            case "ETIMEDOUT":
            case "EADDRNOTAVAIL":
            case "EHOSTUNREACH":
              sendStatus("HOST_UNREACHABLE");
              break;
            case "ENETUNREACH":
              sendStatus("NETWORK_UNREACHABLE");
              break;
            case "ECONNREFUSED":
              sendStatus("CONNECTION_REFUSED");
              break;
            default:
              sendStatus("GENERAL_FAILURE");
          }
        }
      });
      stream.on("ready", () => {
        streamOpened = true;
        sendStatus("REQUEST_GRANTED");
        connection.socket.pipe(stream).pipe(connection.socket);
      });
      connection.socket.on("close", () => stream.destroy());
      return stream;
    }
    var Socks5Server = class {
      constructor() {
        this.supportedCommands = /* @__PURE__ */ new Set(["connect"]);
        this.connectionHandler = connectionHandler_default;
        this.server = import_net2.default.createServer((socket) => {
          socket.setNoDelay();
          this._handleConnection(socket);
        });
      }
      listen(...args) {
        this.server.listen(...args);
        return this;
      }
      close(callback) {
        this.server.close(callback);
        return this;
      }
      setAuthHandler(handler) {
        this.authHandler = handler;
        return this;
      }
      disableAuthHandler() {
        this.authHandler = void 0;
        return this;
      }
      setRulesetValidator(handler) {
        this.rulesetValidator = handler;
        return this;
      }
      disableRulesetValidator() {
        this.rulesetValidator = void 0;
        return this;
      }
      setConnectionHandler(handler) {
        this.connectionHandler = handler;
        return this;
      }
      useDefaultConnectionHandler() {
        this.connectionHandler = connectionHandler_default;
        return this;
      }
      // Not private because someone may want to inject a duplex stream to be handled as a connection
      _handleConnection(socket) {
        new Socks5Connection(this, socket);
        return this;
      }
    };
    function createServer3(opts) {
      const server = new Socks5Server();
      if (opts?.auth) server.setAuthHandler((conn) => {
        return conn.username === opts.auth.username && conn.password === opts.auth.password;
      });
      if (opts?.port) server.listen(opts.port, opts.hostname);
      return server;
    }
  }
});

// node_modules/shell-quote/quote.js
var require_quote = __commonJS({
  "node_modules/shell-quote/quote.js"(exports, module) {
    "use strict";
    module.exports = function quote(xs) {
      return xs.map(function(s) {
        if (s === "") {
          return "''";
        }
        if (s && typeof s === "object") {
          return s.op.replace(/(.)/g, "\\$1");
        }
        if (/["\s\\]/.test(s) && !/'/.test(s)) {
          return "'" + s.replace(/(['])/g, "\\$1") + "'";
        }
        if (/["'\s]/.test(s)) {
          return '"' + s.replace(/(["\\$`!])/g, "\\$1") + '"';
        }
        return String(s).replace(/([A-Za-z]:)?([#!"$&'()*,:;<=>?@[\\\]^`{|}])/g, "$1\\$2");
      }).join(" ");
    };
  }
});

// node_modules/shell-quote/parse.js
var require_parse = __commonJS({
  "node_modules/shell-quote/parse.js"(exports, module) {
    "use strict";
    var CONTROL = "(?:" + [
      "\\|\\|",
      "\\&\\&",
      ";;",
      "\\|\\&",
      "\\<\\(",
      "\\<\\<\\<",
      ">>",
      ">\\&",
      "<\\&",
      "[&;()|<>]"
    ].join("|") + ")";
    var controlRE = new RegExp("^" + CONTROL + "$");
    var META = "|&;()<> \\t";
    var SINGLE_QUOTE = '"((\\\\"|[^"])*?)"';
    var DOUBLE_QUOTE = "'((\\\\'|[^'])*?)'";
    var hash = /^#$/;
    var SQ = "'";
    var DQ = '"';
    var DS = "$";
    var TOKEN = "";
    var mult = 4294967296;
    for (i = 0; i < 4; i++) {
      TOKEN += (mult * Math.random()).toString(16);
    }
    var i;
    var startsWithToken = new RegExp("^" + TOKEN);
    function matchAll(s, r) {
      var origIndex = r.lastIndex;
      var matches = [];
      var matchObj;
      while (matchObj = r.exec(s)) {
        matches.push(matchObj);
        if (r.lastIndex === matchObj.index) {
          r.lastIndex += 1;
        }
      }
      r.lastIndex = origIndex;
      return matches;
    }
    function getVar(env, pre, key) {
      var r = typeof env === "function" ? env(key) : env[key];
      if (typeof r === "undefined" && key != "") {
        r = "";
      } else if (typeof r === "undefined") {
        r = "$";
      }
      if (typeof r === "object") {
        return pre + TOKEN + JSON.stringify(r) + TOKEN;
      }
      return pre + r;
    }
    function parseInternal(string, env, opts) {
      if (!opts) {
        opts = {};
      }
      var BS = opts.escape || "\\";
      var BAREWORD = "(\\" + BS + `['"` + META + `]|[^\\s'"` + META + "])+";
      var chunker = new RegExp([
        "(" + CONTROL + ")",
        // control chars
        "(" + BAREWORD + "|" + SINGLE_QUOTE + "|" + DOUBLE_QUOTE + ")+"
      ].join("|"), "g");
      var matches = matchAll(string, chunker);
      if (matches.length === 0) {
        return [];
      }
      if (!env) {
        env = {};
      }
      var commented = false;
      return matches.map(function(match) {
        var s = match[0];
        if (!s || commented) {
          return void 0;
        }
        if (controlRE.test(s)) {
          return { op: s };
        }
        var quote = false;
        var esc = false;
        var out = "";
        var isGlob = false;
        var i2;
        function parseEnvVar() {
          i2 += 1;
          var varend;
          var varname;
          var char = s.charAt(i2);
          if (char === "{") {
            i2 += 1;
            if (s.charAt(i2) === "}") {
              throw new Error("Bad substitution: " + s.slice(i2 - 2, i2 + 1));
            }
            varend = s.indexOf("}", i2);
            if (varend < 0) {
              throw new Error("Bad substitution: " + s.slice(i2));
            }
            varname = s.slice(i2, varend);
            i2 = varend;
          } else if (/[*@#?$!_-]/.test(char)) {
            varname = char;
            i2 += 1;
          } else {
            var slicedFromI = s.slice(i2);
            varend = slicedFromI.match(/[^\w\d_]/);
            if (!varend) {
              varname = slicedFromI;
              i2 = s.length;
            } else {
              varname = slicedFromI.slice(0, varend.index);
              i2 += varend.index - 1;
            }
          }
          return getVar(env, "", varname);
        }
        for (i2 = 0; i2 < s.length; i2++) {
          var c = s.charAt(i2);
          isGlob = isGlob || !quote && (c === "*" || c === "?");
          if (esc) {
            out += c;
            esc = false;
          } else if (quote) {
            if (c === quote) {
              quote = false;
            } else if (quote == SQ) {
              out += c;
            } else {
              if (c === BS) {
                i2 += 1;
                c = s.charAt(i2);
                if (c === DQ || c === BS || c === DS) {
                  out += c;
                } else {
                  out += BS + c;
                }
              } else if (c === DS) {
                out += parseEnvVar();
              } else {
                out += c;
              }
            }
          } else if (c === DQ || c === SQ) {
            quote = c;
          } else if (controlRE.test(c)) {
            return { op: s };
          } else if (hash.test(c)) {
            commented = true;
            var commentObj = { comment: string.slice(match.index + i2 + 1) };
            if (out.length) {
              return [out, commentObj];
            }
            return [commentObj];
          } else if (c === BS) {
            esc = true;
          } else if (c === DS) {
            out += parseEnvVar();
          } else {
            out += c;
          }
        }
        if (isGlob) {
          return { op: "glob", pattern: out };
        }
        return out;
      }).reduce(function(prev, arg) {
        return typeof arg === "undefined" ? prev : prev.concat(arg);
      }, []);
    }
    module.exports = function parse(s, env, opts) {
      var mapped = parseInternal(s, env, opts);
      if (typeof env !== "function") {
        return mapped;
      }
      return mapped.reduce(function(acc, s2) {
        if (typeof s2 === "object") {
          return acc.concat(s2);
        }
        var xs = s2.split(RegExp("(" + TOKEN + ".*?" + TOKEN + ")", "g"));
        if (xs.length === 1) {
          return acc.concat(xs[0]);
        }
        return acc.concat(xs.filter(Boolean).map(function(x) {
          if (startsWithToken.test(x)) {
            return JSON.parse(x.split(TOKEN)[1]);
          }
          return x;
        }));
      }, []);
    };
  }
});

// node_modules/shell-quote/index.js
var require_shell_quote = __commonJS({
  "node_modules/shell-quote/index.js"(exports) {
    "use strict";
    exports.quote = require_quote();
    exports.parse = require_parse();
  }
});

// src/index.ts
import { spawn as spawn5 } from "node:child_process";
import fs7 from "node:fs";
import { existsSync as existsSync5, mkdirSync, readFileSync as readFileSync2, realpathSync as realpathSync5, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { BlockList as BlockList2, isIP as isIP3 } from "node:net";
import { homedir as homedir4 } from "node:os";
import { basename, dirname as dirname5, join as join4, resolve as resolve4 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// node_modules/@carderne/sandbox-runtime/dist/sandbox/http-proxy.js
import { Agent, createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { connect } from "node:net";
import { URL as URL3 } from "node:url";

// node_modules/@carderne/sandbox-runtime/dist/utils/debug.js
function logForDebugging(message, options) {
  if (!process.env.SRT_DEBUG) {
    return;
  }
  const level = options?.level || "info";
  const prefix = "[SandboxDebug]";
  switch (level) {
    case "error":
      console.error(`${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${prefix} ${message}`);
      break;
    default:
      console.error(`${prefix} ${message}`);
  }
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/parent-proxy.js
import { BlockList, connect as netConnect, isIP } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { URL as URL2 } from "node:url";
var CONNECT_TIMEOUT_MS = 3e4;
var HOP_BY_HOP = /* @__PURE__ */ new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
function resolveParentProxy(cfg) {
  const http = cfg?.http ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? void 0;
  const https = cfg?.https ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? // Fall back to HTTP_PROXY for HTTPS if HTTPS_PROXY is unset — this is
  // the de-facto behaviour of curl and most tooling.
  http;
  const noProxyRaw = cfg?.noProxy ?? process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (!http && !https)
    return void 0;
  const parse = (u) => {
    if (!u)
      return void 0;
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(u);
    const withScheme = hasScheme ? u : `http://${u}`;
    try {
      const parsed = new URL2(withScheme);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || !parsed.hostname) {
        throw new Error("unsupported scheme or empty host");
      }
      return parsed;
    } catch {
      logForDebugging(`Invalid parent proxy URL, ignoring: ${redactUserinfo(u)}`, { level: "error" });
      return void 0;
    }
  };
  const httpUrl = parse(http);
  const httpsUrl = parse(https);
  if (!httpUrl && !httpsUrl)
    return void 0;
  return { httpUrl, httpsUrl, noProxy: parseNoProxy(noProxyRaw) };
}
function parseNoProxy(raw) {
  const rules = {
    all: false,
    suffixes: [],
    cidr: new BlockList()
  };
  for (let entry of raw.split(",")) {
    entry = entry.trim();
    if (!entry)
      continue;
    if (entry === "*") {
      rules.all = true;
      continue;
    }
    const slash = entry.indexOf("/");
    if (slash !== -1) {
      const ip = entry.slice(0, slash);
      const prefixStr = entry.slice(slash + 1);
      const fam = isIP(ip);
      if (fam && prefixStr !== "" && /^\d+$/.test(prefixStr)) {
        const prefix = Number(prefixStr);
        const max = fam === 6 ? 128 : 32;
        if (prefix >= 0 && prefix <= max) {
          try {
            rules.cidr.addSubnet(ip, prefix, fam === 6 ? "ipv6" : "ipv4");
          } catch {
          }
          continue;
        }
      }
      continue;
    }
    let v = entry.toLowerCase();
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
    if (bracketed)
      v = bracketed[1];
    if (v.startsWith("*."))
      v = v.slice(1);
    const bareFam = isIP(v);
    if (!bareFam) {
      const colon = v.lastIndexOf(":");
      if (colon !== -1 && /^\d+$/.test(v.slice(colon + 1))) {
        v = v.slice(0, colon);
      }
    } else {
      try {
        rules.cidr.addAddress(v, bareFam === 6 ? "ipv6" : "ipv4");
        continue;
      } catch {
      }
    }
    rules.suffixes.push(v);
  }
  return rules;
}
function shouldBypassParentProxy(resolved, host) {
  const h = stripBrackets(host.toLowerCase().replace(/\.$/, ""));
  if (h === "localhost")
    return true;
  const fam = isIP(h);
  if (fam) {
    if (LOOPBACK.check(h, fam === 6 ? "ipv6" : "ipv4"))
      return true;
  }
  if (resolved.noProxy.all)
    return true;
  if (fam) {
    if (resolved.noProxy.cidr.check(h, fam === 6 ? "ipv6" : "ipv4"))
      return true;
  }
  for (const v of resolved.noProxy.suffixes) {
    if (v.startsWith(".")) {
      if (h === v.slice(1) || h.endsWith(v))
        return true;
    } else {
      if (h === v || h.endsWith("." + v))
        return true;
    }
  }
  return false;
}
var LOOPBACK = (() => {
  const bl = new BlockList();
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addAddress("::1", "ipv6");
  bl.addSubnet("::ffff:127.0.0.0", 104, "ipv6");
  return bl;
})();
function selectParentProxyUrl(resolved, opts) {
  if (opts.isHttps)
    return resolved.httpsUrl ?? resolved.httpUrl;
  return resolved.httpUrl;
}
function openConnectTunnel(opts) {
  const { destHost, destPort } = opts;
  const bare = stripBrackets(destHost);
  if (!isValidHost(bare)) {
    return Promise.reject(new Error(`Invalid destination host for CONNECT: ${JSON.stringify(destHost)}`));
  }
  if (!Number.isInteger(destPort) || destPort < 1 || destPort > 65535) {
    return Promise.reject(new Error(`Invalid destination port: ${destPort}`));
  }
  const authority = isIP(bare) === 6 ? `[${bare}]:${destPort}` : `${bare}:${destPort}`;
  return new Promise((resolve5, reject) => {
    const sock = opts.dial();
    let settled = false;
    const fail = (err) => {
      if (settled)
        return;
      settled = true;
      sock.destroy();
      reject(err);
    };
    const onClose = () => fail(new Error("Proxy closed during CONNECT handshake"));
    sock.setTimeout(opts.timeoutMs ?? CONNECT_TIMEOUT_MS, () => fail(new Error("CONNECT handshake timed out")));
    sock.once("error", fail);
    sock.once("close", onClose);
    sock.once(opts.readyEvent, () => {
      sock.write(`CONNECT ${authority} HTTP/1.1\r
Host: ${authority}\r
` + (opts.authHeader ? `Proxy-Authorization: ${opts.authHeader}\r
` : "") + "\r\n");
      let buf = "";
      const onData = (chunk) => {
        buf += chunk.toString("latin1");
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) {
          if (buf.length > 16 * 1024)
            fail(new Error("CONNECT response header too large"));
          return;
        }
        sock.pause();
        sock.removeListener("data", onData);
        const statusLine = buf.slice(0, buf.indexOf("\r\n"));
        if (!/^HTTP\/1\.[01] 2\d\d(?:\s|$)/.test(statusLine)) {
          return fail(new Error(`Proxy refused CONNECT: ${statusLine.trim()}`));
        }
        const rest = buf.slice(end + 4);
        if (rest.length)
          sock.unshift(Buffer.from(rest, "latin1"));
        settled = true;
        sock.setTimeout(0);
        sock.removeListener("error", fail);
        sock.removeListener("close", onClose);
        resolve5(sock);
      };
      sock.on("data", onData);
    });
  });
}
function connectViaParentProxy(proxyUrl, destHost, destPort) {
  const proxyHost = stripBrackets(proxyUrl.hostname);
  const proxyPort = Number(proxyUrl.port) || (proxyUrl.protocol === "https:" ? 443 : 80);
  const useTls = proxyUrl.protocol === "https:";
  return openConnectTunnel({
    destHost,
    destPort,
    authHeader: proxyAuthHeader(proxyUrl),
    readyEvent: useTls ? "secureConnect" : "connect",
    dial: () => useTls ? tlsConnect({
      host: proxyHost,
      port: proxyPort,
      // SNI must be a hostname, never an IP literal (RFC 6066 §3).
      ...isIP(proxyHost) ? {} : { servername: proxyHost }
    }) : netConnect(proxyPort, proxyHost)
  });
}
function proxyAuthHeader(proxyUrl) {
  if (!proxyUrl.username && !proxyUrl.password)
    return void 0;
  try {
    const creds = `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`;
    return `Basic ${Buffer.from(creds).toString("base64")}`;
  } catch {
    const creds = `${proxyUrl.username}:${proxyUrl.password}`;
    return `Basic ${Buffer.from(creds).toString("base64")}`;
  }
}
function stripHopByHop(h) {
  const extra = /* @__PURE__ */ new Set();
  const connHeader = h.connection;
  if (connHeader) {
    for (const tok of String(connHeader).split(",")) {
      extra.add(tok.trim().toLowerCase());
    }
  }
  const out = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (!HOP_BY_HOP.has(lk) && !extra.has(lk))
      out[k] = v;
  }
  return out;
}
function stripBrackets(host) {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}
function redactUrl(u) {
  if (!u)
    return "-";
  if (!u.username && !u.password)
    return u.href;
  const c = new URL2(u.href);
  c.username = "***";
  c.password = "***";
  return c.href;
}
function redactUserinfo(raw) {
  return raw.replace(/\/\/[^@/]*@/, "//***:***@");
}
function isValidHost(h) {
  if (!h || h.length > 255)
    return false;
  const bare = stripBrackets(h);
  if (bare.includes("%"))
    return false;
  if (isIP(bare))
    return true;
  return /^[A-Za-z0-9._-]+$/.test(bare);
}
function canonicalizeHost(h) {
  try {
    const bare = stripBrackets(h);
    const bracketed = isIP(bare) === 6 ? `[${bare}]` : bare;
    const out = new URL2(`http://${bracketed}/`).hostname;
    return stripBrackets(out).replace(/\.$/, "");
  } catch {
    return void 0;
  }
}
function dialDirect(host, port, timeoutMs = CONNECT_TIMEOUT_MS) {
  return new Promise((resolve5, reject) => {
    const s = netConnect(port, host);
    let settled = false;
    const done = (err) => {
      if (settled)
        return;
      settled = true;
      s.setTimeout(0);
      if (err) {
        s.destroy();
        reject(err);
      } else {
        resolve5(s);
      }
    };
    s.setTimeout(timeoutMs, () => done(new Error("connect timed out")));
    s.once("connect", () => done());
    s.once("error", done);
    s.once("close", () => done(new Error("socket closed before connect")));
  });
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/http-proxy.js
function createHttpProxyServer(options) {
  const server = createServer();
  server.on("connect", async (req, socket, head) => {
    socket.on("error", (err) => {
      logForDebugging(`Client socket error: ${err.message}`, { level: "error" });
    });
    let clientGone = false;
    socket.once("close", () => {
      clientGone = true;
    });
    try {
      const target = parseConnectTarget(req.url);
      if (!target) {
        logForDebugging(`Invalid CONNECT request: ${req.url}`, {
          level: "error"
        });
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }
      const { hostname, port } = target;
      const allowed = await options.filter(port, hostname, socket);
      if (!allowed) {
        logForDebugging(`Connection blocked to ${hostname}:${port}`, {
          level: "error"
        });
        socket.end("HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nX-Proxy-Error: blocked-by-allowlist\r\n\r\nConnection blocked by network allowlist");
        return;
      }
      const mitmSocketPath = options.getMitmSocketPath?.(hostname);
      const parentUrl = !mitmSocketPath && options.parentProxy && !shouldBypassParentProxy(options.parentProxy, hostname) ? selectParentProxyUrl(options.parentProxy, { isHttps: true }) : void 0;
      let upstream;
      try {
        if (mitmSocketPath) {
          logForDebugging(`Routing CONNECT ${hostname}:${port} through MITM proxy at ${mitmSocketPath}`);
          upstream = await openConnectTunnel({
            dial: () => connect({ path: mitmSocketPath }),
            readyEvent: "connect",
            destHost: hostname,
            destPort: port
          });
        } else if (parentUrl) {
          upstream = await connectViaParentProxy(parentUrl, hostname, port);
        } else {
          upstream = await dialDirect(hostname, port);
        }
      } catch (err) {
        logForDebugging(`CONNECT tunnel failed: ${err.message}`, {
          level: "error"
        });
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        return;
      }
      if (clientGone) {
        upstream.on("error", () => {
        });
        upstream.destroy();
        return;
      }
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length)
        upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
      upstream.on("error", (err) => {
        logForDebugging(`CONNECT tunnel failed: ${err.message}`, {
          level: "error"
        });
        socket.destroy();
      });
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
    } catch (err) {
      logForDebugging(`Error handling CONNECT: ${err}`, { level: "error" });
      socket.end("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    }
  });
  server.on("request", async (req, res) => {
    try {
      const url = new URL3(req.url);
      const hostname = stripBrackets(url.hostname);
      const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
      const allowed = await options.filter(port, hostname, req.socket);
      if (!allowed) {
        logForDebugging(`HTTP request blocked to ${hostname}:${port}`, {
          level: "error"
        });
        res.writeHead(403, {
          "Content-Type": "text/plain",
          "X-Proxy-Error": "blocked-by-allowlist"
        });
        res.end("Connection blocked by network allowlist");
        return;
      }
      if (req.socket.destroyed)
        return;
      const fwdHeaders = { ...stripHopByHop(req.headers), host: url.host };
      const mitmSocketPath = options.getMitmSocketPath?.(hostname);
      const parentUrl = !mitmSocketPath && options.parentProxy && !shouldBypassParentProxy(options.parentProxy, hostname) ? selectParentProxyUrl(options.parentProxy, {
        isHttps: url.protocol === "https:"
      }) : void 0;
      const absUrl = `${url.protocol}//${url.host}${url.pathname}${url.search}`;
      let proxyReq;
      if (mitmSocketPath) {
        logForDebugging(`Routing HTTP ${req.method} ${hostname}:${port} through MITM proxy at ${mitmSocketPath}`);
        const mitmAgent = new Agent({
          // @ts-expect-error - socketPath is valid but not in types
          socketPath: mitmSocketPath
        });
        proxyReq = httpRequest({
          agent: mitmAgent,
          path: absUrl,
          method: req.method,
          headers: fwdHeaders
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, stripHopByHop(proxyRes.headers));
          proxyRes.pipe(res);
        });
      } else if (parentUrl) {
        const parentHost = stripBrackets(parentUrl.hostname);
        const parentPort = Number(parentUrl.port) || (parentUrl.protocol === "https:" ? 443 : 80);
        const auth = proxyAuthHeader(parentUrl);
        const requestFn = parentUrl.protocol === "https:" ? httpsRequest : httpRequest;
        proxyReq = requestFn({
          hostname: parentHost,
          port: parentPort,
          path: absUrl,
          method: req.method,
          headers: auth ? { ...fwdHeaders, "proxy-authorization": auth } : fwdHeaders
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, stripHopByHop(proxyRes.headers));
          proxyRes.pipe(res);
        });
      } else {
        const requestFn = url.protocol === "https:" ? httpsRequest : httpRequest;
        proxyReq = requestFn({
          hostname,
          port,
          path: url.pathname + url.search,
          method: req.method,
          headers: fwdHeaders
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode, stripHopByHop(proxyRes.headers));
          proxyRes.pipe(res);
        });
      }
      proxyReq.on("error", (err) => {
        logForDebugging(`Proxy request failed: ${err.message}`, {
          level: "error"
        });
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end("Bad Gateway");
        } else {
          res.destroy();
        }
      });
      res.on("close", () => proxyReq.destroy());
      req.pipe(proxyReq);
    } catch (err) {
      logForDebugging(`Error handling HTTP request: ${err}`, { level: "error" });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      } else {
        res.destroy();
      }
    }
  });
  return server;
}
function parseConnectTarget(target) {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(target) ?? /^([^:]+):(\d+)$/.exec(target);
  if (!m)
    return void 0;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return void 0;
  return { hostname: m[1], port };
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/socks-proxy.js
var import_socks5_server = __toESM(require_dist(), 1);
function createSocksProxyServer(options) {
  const socksServer = (0, import_socks5_server.createServer)();
  socksServer.setRulesetValidator(async (conn) => {
    try {
      const hostname = conn.destAddress;
      const port = conn.destPort;
      if (!isValidHost(hostname)) {
        logForDebugging(`Rejecting malformed SOCKS host: ${JSON.stringify(hostname)}`, { level: "error" });
        return false;
      }
      logForDebugging(`Connection request to ${hostname}:${port}`);
      const allowed = await options.filter(port, hostname);
      if (!allowed) {
        logForDebugging(`Connection blocked to ${hostname}:${port}`, {
          level: "error"
        });
        return false;
      }
      logForDebugging(`Connection allowed to ${hostname}:${port}`);
      return true;
    } catch (error) {
      logForDebugging(`Error validating connection: ${error}`, {
        level: "error"
      });
      return false;
    }
  });
  socksServer.setConnectionHandler((conn, sendStatus) => {
    const host = conn.destAddress;
    const port = conn.destPort;
    let clientGone = false;
    let upstreamRef;
    conn.socket.once("close", () => {
      clientGone = true;
      upstreamRef?.destroy();
    });
    conn.socket.on("error", () => upstreamRef?.destroy());
    const parentUrl = options.parentProxy && !shouldBypassParentProxy(options.parentProxy, host) ? selectParentProxyUrl(options.parentProxy, { isHttps: true }) : void 0;
    const open = parentUrl ? connectViaParentProxy(parentUrl, host, port) : dialDirect(host, port);
    open.then((upstream) => {
      upstreamRef = upstream;
      upstream.on("error", () => conn.socket.destroy());
      if (clientGone) {
        upstream.destroy();
        return;
      }
      sendStatus("REQUEST_GRANTED");
      upstream.pipe(conn.socket);
      conn.socket.pipe(upstream);
      upstream.on("close", () => conn.socket.destroy());
    }).catch((err) => {
      logForDebugging(`SOCKS connect to ${host}:${port} failed: ${err.message}`, { level: "error" });
      if (!clientGone) {
        try {
          sendStatus("HOST_UNREACHABLE");
        } catch {
        }
      }
    });
  });
  return {
    server: socksServer,
    getPort() {
      try {
        const serverInternal = socksServer?.server;
        if (serverInternal && typeof serverInternal?.address === "function") {
          const address = serverInternal.address();
          if (address && typeof address === "object" && "port" in address) {
            return address.port;
          }
        }
      } catch (error) {
        logForDebugging(`Error getting port: ${error}`, { level: "error" });
      }
      return void 0;
    },
    listen(port, hostname) {
      return new Promise((resolve5, reject) => {
        const serverInternal = socksServer?.server;
        serverInternal?.once("error", reject);
        const listeningCallback = () => {
          serverInternal?.removeListener("error", reject);
          const actualPort = this.getPort();
          if (actualPort) {
            logForDebugging(`SOCKS proxy listening on ${hostname}:${actualPort}`);
            resolve5(actualPort);
          } else {
            reject(new Error("Failed to get SOCKS proxy server port"));
          }
        };
        socksServer.listen(port, hostname, listeningCallback);
      });
    },
    async close() {
      return new Promise((resolve5, reject) => {
        socksServer.close((error) => {
          if (error) {
            const errorMessage = error.message?.toLowerCase() || "";
            const isAlreadyClosed = errorMessage.includes("not running") || errorMessage.includes("already closed") || errorMessage.includes("not listening");
            if (!isAlreadyClosed) {
              reject(error);
              return;
            }
          }
          resolve5();
        });
      });
    },
    unref() {
      try {
        const serverInternal = socksServer?.server;
        if (serverInternal && typeof serverInternal?.unref === "function") {
          serverInternal.unref();
        }
      } catch (error) {
        logForDebugging(`Error calling unref: ${error}`, { level: "error" });
      }
    }
  };
}

// node_modules/@carderne/sandbox-runtime/dist/utils/which.js
import { spawnSync } from "node:child_process";
function whichSync(bin) {
  if (typeof globalThis.Bun !== "undefined") {
    return globalThis.Bun.which(bin);
  }
  const result = spawnSync("which", [bin], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 1e3
  });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return null;
}

// node_modules/@carderne/sandbox-runtime/dist/utils/platform.js
import * as fs from "fs";
function getWslVersion() {
  if (process.platform !== "linux") {
    return void 0;
  }
  try {
    const procVersion = fs.readFileSync("/proc/version", { encoding: "utf8" });
    const wslVersionMatch = procVersion.match(/WSL(\d+)/i);
    if (wslVersionMatch && wslVersionMatch[1]) {
      return wslVersionMatch[1];
    }
    if (procVersion.toLowerCase().includes("microsoft")) {
      return "1";
    }
    return void 0;
  } catch {
    return void 0;
  }
}
function getPlatform() {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/sandbox-manager.js
import * as fs5 from "fs";

// node_modules/@carderne/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js
var import_shell_quote = __toESM(require_shell_quote(), 1);
import { randomBytes } from "node:crypto";
import * as fs4 from "fs";
import { spawn as spawn2 } from "node:child_process";
import { tmpdir } from "node:os";
import path2, { join as join3 } from "node:path";

// node_modules/@carderne/sandbox-runtime/dist/utils/ripgrep.js
import { spawn } from "child_process";
import { text } from "node:stream/consumers";
async function ripGrep(args, target, abortSignal, config2 = { command: "rg" }) {
  const { command, args: commandArgs = [], argv0 } = config2;
  const child = spawn(command, [...commandArgs, ...args, target], {
    argv0,
    signal: abortSignal,
    timeout: 1e4,
    windowsHide: true
  });
  const [stdout, stderr, code] = await Promise.all([
    text(child.stdout),
    text(child.stderr),
    new Promise((resolve5, reject) => {
      child.on("close", resolve5);
      child.on("error", reject);
    })
  ]);
  if (code === 0) {
    return stdout.trim().split("\n").filter(Boolean);
  }
  if (code === 1) {
    return [];
  }
  throw new Error(`ripgrep failed with exit code ${code}: ${stderr}`);
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/sandbox-utils.js
import { homedir } from "os";
import * as path from "path";
import * as fs2 from "fs";
var DANGEROUS_FILES = [
  ".gitconfig",
  ".gitmodules",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".zprofile",
  ".profile",
  ".ripgreprc",
  ".mcp.json"
];
var DANGEROUS_DIRECTORIES = [".git", ".vscode", ".idea"];
function getDangerousDirectories() {
  return [
    ...DANGEROUS_DIRECTORIES.filter((d) => d !== ".git"),
    ".claude/commands",
    ".claude/agents"
  ];
}
function normalizeCaseForComparison(pathStr) {
  return pathStr.toLowerCase();
}
function containsGlobChars(pathPattern) {
  return pathPattern.includes("*") || pathPattern.includes("?") || pathPattern.includes("[") || pathPattern.includes("]");
}
function removeTrailingGlobSuffix(pathPattern) {
  const stripped = pathPattern.replace(/\/\*\*$/, "");
  return stripped || "/";
}
function isSymlinkOutsideBoundary(originalPath, resolvedPath) {
  const normalizedOriginal = path.normalize(originalPath);
  const normalizedResolved = path.normalize(resolvedPath);
  if (normalizedResolved === normalizedOriginal) {
    return false;
  }
  if (normalizedOriginal.startsWith("/tmp/") && normalizedResolved === "/private" + normalizedOriginal) {
    return false;
  }
  if (normalizedOriginal.startsWith("/var/") && normalizedResolved === "/private" + normalizedOriginal) {
    return false;
  }
  if (normalizedOriginal.startsWith("/private/tmp/") && normalizedResolved === normalizedOriginal) {
    return false;
  }
  if (normalizedOriginal.startsWith("/private/var/") && normalizedResolved === normalizedOriginal) {
    return false;
  }
  if (normalizedResolved === "/") {
    return true;
  }
  const resolvedParts = normalizedResolved.split("/").filter(Boolean);
  if (resolvedParts.length <= 1) {
    return true;
  }
  if (normalizedOriginal.startsWith(normalizedResolved + "/")) {
    return true;
  }
  let canonicalOriginal = normalizedOriginal;
  if (normalizedOriginal.startsWith("/tmp/")) {
    canonicalOriginal = "/private" + normalizedOriginal;
  } else if (normalizedOriginal.startsWith("/var/")) {
    canonicalOriginal = "/private" + normalizedOriginal;
  }
  if (canonicalOriginal !== normalizedOriginal && canonicalOriginal.startsWith(normalizedResolved + "/")) {
    return true;
  }
  const resolvedStartsWithOriginal = normalizedResolved.startsWith(normalizedOriginal + "/");
  const resolvedStartsWithCanonical = canonicalOriginal !== normalizedOriginal && normalizedResolved.startsWith(canonicalOriginal + "/");
  const resolvedIsCanonical = canonicalOriginal !== normalizedOriginal && normalizedResolved === canonicalOriginal;
  const resolvedIsSame = normalizedResolved === normalizedOriginal;
  if (!resolvedIsSame && !resolvedIsCanonical && !resolvedStartsWithOriginal && !resolvedStartsWithCanonical) {
    return true;
  }
  return false;
}
function normalizePathForSandbox(pathPattern) {
  const cwd = process.cwd();
  let normalizedPath = pathPattern;
  if (pathPattern === "~") {
    normalizedPath = homedir();
  } else if (pathPattern.startsWith("~/")) {
    normalizedPath = homedir() + pathPattern.slice(1);
  } else if (pathPattern.startsWith("./") || pathPattern.startsWith("../")) {
    normalizedPath = path.resolve(cwd, pathPattern);
  } else if (!path.isAbsolute(pathPattern)) {
    normalizedPath = path.resolve(cwd, pathPattern);
  }
  if (containsGlobChars(normalizedPath)) {
    const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
    if (staticPrefix && staticPrefix !== "/") {
      const baseDir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : path.dirname(staticPrefix);
      try {
        const resolvedBaseDir = fs2.realpathSync(baseDir);
        if (!isSymlinkOutsideBoundary(baseDir, resolvedBaseDir)) {
          const patternSuffix = normalizedPath.slice(baseDir.length);
          return resolvedBaseDir + patternSuffix;
        }
      } catch {
      }
    }
    return normalizedPath;
  }
  try {
    const resolvedPath = fs2.realpathSync(normalizedPath);
    if (isSymlinkOutsideBoundary(normalizedPath, resolvedPath)) {
    } else {
      normalizedPath = resolvedPath;
    }
  } catch {
  }
  return normalizedPath;
}
function getDefaultWritePaths() {
  const homeDir = homedir();
  const recommendedPaths = [
    "/dev/stdout",
    "/dev/stderr",
    "/dev/null",
    "/dev/tty",
    "/dev/dtracehelper",
    "/dev/autofs_nowait",
    "/tmp/claude",
    "/private/tmp/claude",
    path.join(homeDir, ".npm/_logs"),
    path.join(homeDir, ".claude/debug")
  ];
  return recommendedPaths;
}
function generateProxyEnvVars(httpProxyPort, socksProxyPort) {
  const tmpdir3 = process.env.CLAUDE_TMPDIR || "/tmp/claude";
  const envVars = [`SANDBOX_RUNTIME=1`, `TMPDIR=${tmpdir3}`];
  if (!httpProxyPort && !socksProxyPort) {
    return envVars;
  }
  const noProxyAddresses = [
    "localhost",
    "127.0.0.1",
    "::1",
    "*.local",
    ".local",
    "169.254.0.0/16",
    // Link-local
    "10.0.0.0/8",
    // Private network
    "172.16.0.0/12",
    // Private network
    "192.168.0.0/16"
    // Private network
  ].join(",");
  if (httpProxyPort) {
    envVars.push(`HTTP_PROXY=http://localhost:${httpProxyPort}`);
    envVars.push(`HTTPS_PROXY=http://localhost:${httpProxyPort}`);
    envVars.push(`http_proxy=http://localhost:${httpProxyPort}`);
    envVars.push(`https_proxy=http://localhost:${httpProxyPort}`);
  }
  if (socksProxyPort) {
    envVars.push(`ALL_PROXY=socks5h://localhost:${socksProxyPort}`);
    envVars.push(`all_proxy=socks5h://localhost:${socksProxyPort}`);
    const platform = getPlatform();
    if (platform === "macos") {
      envVars.push(`GIT_SSH_COMMAND=ssh -o ProxyCommand='nc -X 5 -x localhost:${socksProxyPort} %h %p'`);
    } else if (platform === "linux" && httpProxyPort) {
      envVars.push(`GIT_SSH_COMMAND=ssh -o ProxyCommand='socat - PROXY:localhost:%h:%p,proxyport=${httpProxyPort}'`);
    }
    envVars.push(`FTP_PROXY=socks5h://localhost:${socksProxyPort}`);
    envVars.push(`ftp_proxy=socks5h://localhost:${socksProxyPort}`);
    envVars.push(`RSYNC_PROXY=localhost:${socksProxyPort}`);
    envVars.push(`DOCKER_HTTP_PROXY=http://localhost:${httpProxyPort || socksProxyPort}`);
    envVars.push(`DOCKER_HTTPS_PROXY=http://localhost:${httpProxyPort || socksProxyPort}`);
    if (httpProxyPort) {
      envVars.push(`CLOUDSDK_PROXY_TYPE=https`);
      envVars.push(`CLOUDSDK_PROXY_ADDRESS=localhost`);
      envVars.push(`CLOUDSDK_PROXY_PORT=${httpProxyPort}`);
    }
    envVars.push(`GRPC_PROXY=socks5h://localhost:${socksProxyPort}`);
    envVars.push(`grpc_proxy=socks5h://localhost:${socksProxyPort}`);
  }
  return envVars;
}
function encodeSandboxedCommand(command) {
  const truncatedCommand = command.slice(0, 100);
  return Buffer.from(truncatedCommand).toString("base64");
}
function decodeSandboxedCommand(encodedCommand) {
  return Buffer.from(encodedCommand, "base64").toString("utf8");
}
function globToRegex(globPattern) {
  return "^" + globPattern.replace(/[.^$+{}()|\\]/g, "\\$&").replace(/\[([^\]]*?)$/g, "\\[$1").replace(/\*\*\//g, "__GLOBSTAR_SLASH__").replace(/\*\*/g, "__GLOBSTAR__").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/__GLOBSTAR_SLASH__/g, "(.*/)?").replace(/__GLOBSTAR__/g, ".*") + // ** matches anything including /
  "$";
}
function expandGlobPattern(globPath) {
  const normalizedPattern = normalizePathForSandbox(globPath);
  const staticPrefix = normalizedPattern.split(/[*?[\]]/)[0];
  if (!staticPrefix || staticPrefix === "/") {
    logForDebugging(`[Sandbox] Glob pattern too broad, skipping: ${globPath}`);
    return [];
  }
  const baseDir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : path.dirname(staticPrefix);
  if (!fs2.existsSync(baseDir)) {
    logForDebugging(`[Sandbox] Base directory for glob does not exist: ${baseDir}`);
    return [];
  }
  const regex = new RegExp(globToRegex(normalizedPattern));
  const results = [];
  try {
    const entries = fs2.readdirSync(baseDir, {
      recursive: true,
      withFileTypes: true
    });
    for (const entry of entries) {
      const parentDir = entry.parentPath ?? entry.path ?? baseDir;
      const fullPath = path.join(parentDir, entry.name);
      if (regex.test(fullPath)) {
        results.push(fullPath);
      }
    }
  } catch (err) {
    logForDebugging(`[Sandbox] Error expanding glob pattern ${globPath}: ${err}`);
  }
  return results;
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/generate-seccomp-filter.js
import { join as join2, dirname as dirname2 } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs3 from "node:fs";
import { execSync } from "node:child_process";
import { homedir as homedir2 } from "node:os";
var applySeccompPathCache = /* @__PURE__ */ new Map();
var cachedGlobalNpmPaths = null;
function getGlobalNpmPaths() {
  if (cachedGlobalNpmPaths)
    return cachedGlobalNpmPaths;
  const paths = [];
  try {
    const npmRoot = execSync("npm root -g", {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    if (npmRoot) {
      paths.push(join2(npmRoot, "@anthropic-ai", "sandbox-runtime"));
    }
  } catch {
  }
  const home = homedir2();
  paths.push(
    // npm global (Linux/macOS)
    join2("/usr", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime"),
    join2("/usr", "local", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime"),
    // npm global with prefix (common on macOS with homebrew)
    join2("/opt", "homebrew", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime"),
    // User-local npm global
    join2(home, ".npm", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime"),
    join2(home, ".npm-global", "lib", "node_modules", "@anthropic-ai", "sandbox-runtime")
  );
  cachedGlobalNpmPaths = paths;
  return paths;
}
function getVendorArchitecture() {
  const arch = process.arch;
  switch (arch) {
    case "x64":
    case "x86_64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    case "ia32":
    case "x86":
      logForDebugging(`[SeccompFilter] 32-bit x86 (ia32) is not currently supported due to missing socketcall() syscall blocking. The current seccomp filter only blocks socket(AF_UNIX, ...), but on 32-bit x86, socketcall() can be used to bypass this.`, { level: "error" });
      return null;
    default:
      logForDebugging(`[SeccompFilter] Unsupported architecture: ${arch}. Only x64 and arm64 are supported.`);
      return null;
  }
}
function getLocalSeccompPaths(filename) {
  const arch = getVendorArchitecture();
  if (!arch)
    return [];
  const baseDir = dirname2(fileURLToPath(import.meta.url));
  const relativePath = join2("vendor", "seccomp", arch, filename);
  return [
    join2(baseDir, relativePath),
    // bundled: same directory as bundle (e.g., when bundled into claude-cli)
    join2(baseDir, "..", "..", relativePath),
    // package root: vendor/seccomp/...
    join2(baseDir, "..", relativePath)
    // dist: dist/vendor/seccomp/...
  ];
}
function getApplySeccompBinaryPath(seccompBinaryPath) {
  const cacheKey = seccompBinaryPath ?? "";
  if (applySeccompPathCache.has(cacheKey)) {
    return applySeccompPathCache.get(cacheKey);
  }
  const result = findApplySeccompPath(seccompBinaryPath);
  applySeccompPathCache.set(cacheKey, result);
  return result;
}
function findApplySeccompPath(seccompBinaryPath) {
  if (seccompBinaryPath) {
    if (fs3.existsSync(seccompBinaryPath)) {
      logForDebugging(`[SeccompFilter] Using apply-seccomp binary from explicit path: ${seccompBinaryPath}`);
      return seccompBinaryPath;
    }
    logForDebugging(`[SeccompFilter] Explicit path provided but file not found: ${seccompBinaryPath}`);
  }
  const arch = getVendorArchitecture();
  if (!arch) {
    logForDebugging(`[SeccompFilter] Cannot find apply-seccomp binary: unsupported architecture ${process.arch}`);
    return null;
  }
  logForDebugging(`[SeccompFilter] Looking for apply-seccomp binary for architecture: ${arch}`);
  for (const binaryPath of getLocalSeccompPaths("apply-seccomp")) {
    if (fs3.existsSync(binaryPath)) {
      logForDebugging(`[SeccompFilter] Found apply-seccomp binary: ${binaryPath} (${arch})`);
      return binaryPath;
    }
  }
  for (const globalBase of getGlobalNpmPaths()) {
    const binaryPath = join2(globalBase, "vendor", "seccomp", arch, "apply-seccomp");
    if (fs3.existsSync(binaryPath)) {
      logForDebugging(`[SeccompFilter] Found apply-seccomp binary in global install: ${binaryPath} (${arch})`);
      return binaryPath;
    }
  }
  logForDebugging(`[SeccompFilter] apply-seccomp binary not found in any expected location (${arch})`);
  return null;
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/linux-sandbox-utils.js
var DEFAULT_MANDATORY_DENY_SEARCH_DEPTH = 3;
function findSymlinkInPath(targetPath, allowedWritePaths) {
  const parts = targetPath.split(path2.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part)
      continue;
    const nextPath = currentPath + path2.sep + part;
    try {
      const stats = fs4.lstatSync(nextPath);
      if (stats.isSymbolicLink()) {
        const isWithinAllowedPath = allowedWritePaths.some((allowedPath) => nextPath.startsWith(allowedPath + "/") || nextPath === allowedPath);
        if (isWithinAllowedPath) {
          return nextPath;
        }
      }
    } catch {
      break;
    }
    currentPath = nextPath;
  }
  return null;
}
function hasFileAncestor(targetPath) {
  const parts = targetPath.split(path2.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part)
      continue;
    const nextPath = currentPath + path2.sep + part;
    try {
      const stat = fs4.statSync(nextPath);
      if (stat.isFile() || stat.isSymbolicLink()) {
        return true;
      }
    } catch {
      break;
    }
    currentPath = nextPath;
  }
  return false;
}
function findFirstNonExistentComponent(targetPath) {
  const parts = targetPath.split(path2.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part)
      continue;
    const nextPath = currentPath + path2.sep + part;
    if (!fs4.existsSync(nextPath)) {
      return nextPath;
    }
    currentPath = nextPath;
  }
  return targetPath;
}
async function linuxGetMandatoryDenyPaths(ripgrepConfig = { command: "rg" }, maxDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH, allowGitConfig = false, abortSignal) {
  const cwd = process.cwd();
  const fallbackController = new AbortController();
  const signal = abortSignal ?? fallbackController.signal;
  const dangerousDirectories = getDangerousDirectories();
  const denyPaths = [
    // Dangerous files in CWD
    ...DANGEROUS_FILES.map((f) => path2.resolve(cwd, f)),
    // Dangerous directories in CWD
    ...dangerousDirectories.map((d) => path2.resolve(cwd, d))
  ];
  const dotGitPath = path2.resolve(cwd, ".git");
  let dotGitIsDirectory = false;
  try {
    dotGitIsDirectory = fs4.statSync(dotGitPath).isDirectory();
  } catch {
  }
  if (dotGitIsDirectory) {
    denyPaths.push(path2.resolve(cwd, ".git/hooks"));
    if (!allowGitConfig) {
      denyPaths.push(path2.resolve(cwd, ".git/config"));
    }
  }
  const iglobArgs = [];
  for (const fileName of DANGEROUS_FILES) {
    iglobArgs.push("--iglob", fileName);
  }
  for (const dirName of dangerousDirectories) {
    iglobArgs.push("--iglob", `**/${dirName}/**`);
  }
  iglobArgs.push("--iglob", "**/.git/hooks/**");
  if (!allowGitConfig) {
    iglobArgs.push("--iglob", "**/.git/config");
  }
  let matches = [];
  try {
    matches = await ripGrep([
      "--files",
      "--hidden",
      "--max-depth",
      String(maxDepth),
      ...iglobArgs,
      "-g",
      "!**/node_modules/**"
    ], cwd, signal, ripgrepConfig);
  } catch (error) {
    logForDebugging(`[Sandbox] ripgrep scan failed: ${error}`);
  }
  for (const match of matches) {
    const absolutePath = path2.resolve(cwd, match);
    let foundDir = false;
    for (const dirName of [...dangerousDirectories, ".git"]) {
      const normalizedDirName = normalizeCaseForComparison(dirName);
      const segments = absolutePath.split(path2.sep);
      const dirIndex = segments.findIndex((s) => normalizeCaseForComparison(s) === normalizedDirName);
      if (dirIndex !== -1) {
        if (dirName === ".git") {
          const gitDir = segments.slice(0, dirIndex + 1).join(path2.sep);
          if (match.includes(".git/hooks")) {
            denyPaths.push(path2.join(gitDir, "hooks"));
          } else if (match.includes(".git/config")) {
            denyPaths.push(path2.join(gitDir, "config"));
          }
        } else {
          denyPaths.push(segments.slice(0, dirIndex + 1).join(path2.sep));
        }
        foundDir = true;
        break;
      }
    }
    if (!foundDir) {
      denyPaths.push(absolutePath);
    }
  }
  return [...new Set(denyPaths)];
}
var bwrapMountPoints = /* @__PURE__ */ new Set();
var activeSandboxCount = 0;
var exitHandlerRegistered = false;
function registerExitCleanupHandler() {
  if (exitHandlerRegistered) {
    return;
  }
  process.on("exit", () => {
    cleanupBwrapMountPoints({ force: true });
  });
  exitHandlerRegistered = true;
}
function cleanupBwrapMountPoints(opts) {
  if (!opts?.force) {
    if (activeSandboxCount > 0) {
      activeSandboxCount--;
    }
    if (activeSandboxCount > 0) {
      logForDebugging(`[Sandbox Linux] Deferring mount point cleanup \u2014 ${activeSandboxCount} sandbox(es) still active`);
      return;
    }
  } else {
    activeSandboxCount = 0;
  }
  for (const mountPoint of bwrapMountPoints) {
    try {
      const stat = fs4.statSync(mountPoint);
      if (stat.isFile() && stat.size === 0) {
        fs4.unlinkSync(mountPoint);
        logForDebugging(`[Sandbox Linux] Cleaned up bwrap mount point (file): ${mountPoint}`);
      } else if (stat.isDirectory()) {
        const entries = fs4.readdirSync(mountPoint);
        if (entries.length === 0) {
          fs4.rmdirSync(mountPoint);
          logForDebugging(`[Sandbox Linux] Cleaned up bwrap mount point (dir): ${mountPoint}`);
        }
      }
    } catch {
    }
  }
  bwrapMountPoints.clear();
}
function checkLinuxDependencies(seccompConfig) {
  const errors = [];
  const warnings = [];
  if (whichSync("bwrap") === null)
    errors.push("bubblewrap (bwrap) not installed");
  if (whichSync("socat") === null)
    errors.push("socat not installed");
  if (!seccompConfig?.argv0 && getApplySeccompBinaryPath(seccompConfig?.applyPath) === null) {
    warnings.push("seccomp not available - unix socket access not restricted");
  }
  return { warnings, errors };
}
async function initializeLinuxNetworkBridge(httpProxyPort, socksProxyPort) {
  const socketId = randomBytes(8).toString("hex");
  const httpSocketPath = join3(tmpdir(), `claude-http-${socketId}.sock`);
  const socksSocketPath = join3(tmpdir(), `claude-socks-${socketId}.sock`);
  const httpSocatArgs = [
    `UNIX-LISTEN:${httpSocketPath},fork,reuseaddr`,
    `TCP:localhost:${httpProxyPort},keepalive,keepidle=10,keepintvl=5,keepcnt=3`
  ];
  logForDebugging(`Starting HTTP bridge: socat ${httpSocatArgs.join(" ")}`);
  const httpBridgeProcess = spawn2("socat", httpSocatArgs, {
    stdio: "ignore"
  });
  if (!httpBridgeProcess.pid) {
    throw new Error("Failed to start HTTP bridge process");
  }
  httpBridgeProcess.on("error", (err) => {
    logForDebugging(`HTTP bridge process error: ${err}`, { level: "error" });
  });
  httpBridgeProcess.on("exit", (code, signal) => {
    logForDebugging(`HTTP bridge process exited with code ${code}, signal ${signal}`, { level: code === 0 ? "info" : "error" });
  });
  const socksSocatArgs = [
    `UNIX-LISTEN:${socksSocketPath},fork,reuseaddr`,
    `TCP:localhost:${socksProxyPort},keepalive,keepidle=10,keepintvl=5,keepcnt=3`
  ];
  logForDebugging(`Starting SOCKS bridge: socat ${socksSocatArgs.join(" ")}`);
  const socksBridgeProcess = spawn2("socat", socksSocatArgs, {
    stdio: "ignore"
  });
  if (!socksBridgeProcess.pid) {
    if (httpBridgeProcess.pid) {
      try {
        process.kill(httpBridgeProcess.pid, "SIGTERM");
      } catch {
      }
    }
    throw new Error("Failed to start SOCKS bridge process");
  }
  socksBridgeProcess.on("error", (err) => {
    logForDebugging(`SOCKS bridge process error: ${err}`, { level: "error" });
  });
  socksBridgeProcess.on("exit", (code, signal) => {
    logForDebugging(`SOCKS bridge process exited with code ${code}, signal ${signal}`, { level: code === 0 ? "info" : "error" });
  });
  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    if (!httpBridgeProcess.pid || httpBridgeProcess.killed || !socksBridgeProcess.pid || socksBridgeProcess.killed) {
      throw new Error("Linux bridge process died unexpectedly");
    }
    try {
      if (fs4.existsSync(httpSocketPath) && fs4.existsSync(socksSocketPath)) {
        logForDebugging(`Linux bridges ready after ${i + 1} attempts`);
        break;
      }
    } catch (err) {
      logForDebugging(`Error checking sockets (attempt ${i + 1}): ${err}`, {
        level: "error"
      });
    }
    if (i === maxAttempts - 1) {
      if (httpBridgeProcess.pid) {
        try {
          process.kill(httpBridgeProcess.pid, "SIGTERM");
        } catch {
        }
      }
      if (socksBridgeProcess.pid) {
        try {
          process.kill(socksBridgeProcess.pid, "SIGTERM");
        } catch {
        }
      }
      throw new Error(`Failed to create bridge sockets after ${maxAttempts} attempts`);
    }
    await new Promise((resolve5) => setTimeout(resolve5, i * 100));
  }
  return {
    httpSocketPath,
    socksSocketPath,
    httpBridgeProcess,
    socksBridgeProcess,
    httpProxyPort,
    socksProxyPort
  };
}
function resolveApplySeccompPrefix(applyPath, argv0) {
  if (argv0) {
    if (!applyPath) {
      throw new Error("seccompConfig.argv0 requires seccompConfig.applyPath");
    }
    return `ARGV0=${import_shell_quote.default.quote([argv0])} ${import_shell_quote.default.quote([applyPath])} `;
  }
  const binary = getApplySeccompBinaryPath(applyPath);
  return binary ? `${import_shell_quote.default.quote([binary])} ` : void 0;
}
function buildSandboxCommand(httpSocketPath, socksSocketPath, userCommand, applySeccompPrefix, shell) {
  const shellPath = shell || "bash";
  const socatCommands = [
    `socat TCP-LISTEN:3128,fork,reuseaddr UNIX-CONNECT:${httpSocketPath} >/dev/null 2>&1 &`,
    `socat TCP-LISTEN:1080,fork,reuseaddr UNIX-CONNECT:${socksSocketPath} >/dev/null 2>&1 &`,
    'trap "kill %1 %2 2>/dev/null; exit" EXIT'
  ];
  if (applySeccompPrefix) {
    const applySeccompCmd = applySeccompPrefix + import_shell_quote.default.quote([shellPath, "-c", userCommand]);
    const innerScript = [...socatCommands, applySeccompCmd].join("\n");
    return `${shellPath} -c ${import_shell_quote.default.quote([innerScript])}`;
  } else {
    const innerScript = [
      ...socatCommands,
      `eval ${import_shell_quote.default.quote([userCommand])}`
    ].join("\n");
    return `${shellPath} -c ${import_shell_quote.default.quote([innerScript])}`;
  }
}
async function generateFilesystemArgs(readConfig, writeConfig, ripgrepConfig = { command: "rg" }, mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH, allowGitConfig = false, abortSignal) {
  const args = [];
  const allowedWritePaths = [];
  const denyWriteArgs = [];
  if (writeConfig) {
    args.push("--ro-bind", "/", "/");
    for (const pathPattern of writeConfig.allowOnly || []) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      logForDebugging(`[Sandbox Linux] Processing write path: ${pathPattern} -> ${normalizedPath}`);
      if (normalizedPath.startsWith("/dev/")) {
        logForDebugging(`[Sandbox Linux] Skipping /dev path: ${normalizedPath}`);
        continue;
      }
      if (!fs4.existsSync(normalizedPath)) {
        logForDebugging(`[Sandbox Linux] Skipping non-existent write path: ${normalizedPath}`);
        continue;
      }
      try {
        const resolvedPath = fs4.realpathSync(normalizedPath);
        const normalizedForComparison = normalizedPath.replace(/\/+$/, "");
        if (resolvedPath !== normalizedForComparison && isSymlinkOutsideBoundary(normalizedPath, resolvedPath)) {
          logForDebugging(`[Sandbox Linux] Skipping symlink write path pointing outside expected location: ${pathPattern} -> ${resolvedPath}`);
          continue;
        }
      } catch {
        logForDebugging(`[Sandbox Linux] Skipping write path that could not be resolved: ${normalizedPath}`);
        continue;
      }
      args.push("--bind", normalizedPath, normalizedPath);
      allowedWritePaths.push(normalizedPath);
    }
    const denyPaths = [
      ...writeConfig.denyWithinAllow || [],
      ...await linuxGetMandatoryDenyPaths(ripgrepConfig, mandatoryDenySearchDepth, allowGitConfig, abortSignal)
    ];
    const seenDenyWrite = /* @__PURE__ */ new Set();
    for (const pathPattern of denyPaths) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      if (seenDenyWrite.has(normalizedPath))
        continue;
      seenDenyWrite.add(normalizedPath);
      if (normalizedPath.startsWith("/dev/")) {
        continue;
      }
      const symlinkInPath = findSymlinkInPath(normalizedPath, allowedWritePaths);
      if (symlinkInPath) {
        denyWriteArgs.push("--ro-bind", "/dev/null", symlinkInPath);
        logForDebugging(`[Sandbox Linux] Mounted /dev/null at symlink ${symlinkInPath} to prevent symlink replacement attack`);
        continue;
      }
      if (!fs4.existsSync(normalizedPath)) {
        if (hasFileAncestor(normalizedPath)) {
          logForDebugging(`[Sandbox Linux] Skipping deny path with file ancestor (cannot create paths under a file): ${normalizedPath}`);
          continue;
        }
        let ancestorPath = path2.dirname(normalizedPath);
        while (ancestorPath !== "/" && !fs4.existsSync(ancestorPath)) {
          ancestorPath = path2.dirname(ancestorPath);
        }
        const ancestorIsWithinAllowedPath = allowedWritePaths.some((allowedPath) => ancestorPath.startsWith(allowedPath + "/") || ancestorPath === allowedPath || normalizedPath.startsWith(allowedPath + "/"));
        if (ancestorIsWithinAllowedPath) {
          const firstNonExistent = findFirstNonExistentComponent(normalizedPath);
          if (firstNonExistent !== normalizedPath) {
            const emptyDir = fs4.mkdtempSync(path2.join(tmpdir(), "claude-empty-"));
            denyWriteArgs.push("--ro-bind", emptyDir, firstNonExistent);
            bwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler();
            logForDebugging(`[Sandbox Linux] Mounted empty dir at ${firstNonExistent} to block creation of ${normalizedPath}`);
          } else {
            denyWriteArgs.push("--ro-bind", "/dev/null", firstNonExistent);
            bwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler();
            logForDebugging(`[Sandbox Linux] Mounted /dev/null at ${firstNonExistent} to block creation of ${normalizedPath}`);
          }
        } else {
          logForDebugging(`[Sandbox Linux] Skipping non-existent deny path not within allowed paths: ${normalizedPath}`);
        }
        continue;
      }
      const isWithinAllowedPath = allowedWritePaths.some((allowedPath) => normalizedPath.startsWith(allowedPath + "/") || normalizedPath === allowedPath);
      if (isWithinAllowedPath) {
        denyWriteArgs.push("--ro-bind", normalizedPath, normalizedPath);
      } else {
        logForDebugging(`[Sandbox Linux] Skipping deny path not within allowed paths: ${normalizedPath}`);
      }
    }
  } else {
    args.push("--bind", "/", "/");
  }
  const readDenyPaths = [];
  const readAllowPaths = (readConfig?.allowWithinDeny || []).map((p) => normalizePathForSandbox(p));
  const maskedFiles = /* @__PURE__ */ new Set();
  const rootSkip = /* @__PURE__ */ new Set(["proc", "dev", "sys"]);
  for (const p of readConfig?.denyOnly || []) {
    if (normalizePathForSandbox(p) === "/") {
      for (const child of fs4.readdirSync("/")) {
        if (!rootSkip.has(child))
          readDenyPaths.push("/" + child);
      }
    } else {
      readDenyPaths.push(p);
    }
  }
  if (fs4.existsSync("/etc/ssh/ssh_config.d")) {
    readDenyPaths.push("/etc/ssh/ssh_config.d");
  }
  const normalizedDenyPaths = readDenyPaths.map((p) => normalizePathForSandbox(p)).sort((a, b) => a.split("/").length - b.split("/").length);
  for (const normalizedPath of normalizedDenyPaths) {
    if (!fs4.existsSync(normalizedPath)) {
      logForDebugging(`[Sandbox Linux] Skipping non-existent read deny path: ${normalizedPath}`);
      continue;
    }
    const denySep = normalizedPath === "/" ? "/" : normalizedPath + "/";
    const readDenyStat = fs4.statSync(normalizedPath);
    if (readDenyStat.isDirectory()) {
      args.push("--tmpfs", normalizedPath);
      for (const writePath of allowedWritePaths) {
        if (writePath.startsWith(denySep) || writePath === normalizedPath) {
          args.push("--bind", writePath, writePath);
          logForDebugging(`[Sandbox Linux] Re-bound write path wiped by denyRead tmpfs: ${writePath}`);
        }
      }
      for (const allowPath of readAllowPaths) {
        if (allowPath.startsWith(denySep) || allowPath === normalizedPath) {
          if (!fs4.existsSync(allowPath)) {
            logForDebugging(`[Sandbox Linux] Skipping non-existent read allow path: ${allowPath}`);
            continue;
          }
          if (allowedWritePaths.some((w) => (w.startsWith(denySep) || w === normalizedPath) && (allowPath === w || allowPath.startsWith(w + "/")))) {
            continue;
          }
          args.push("--ro-bind", allowPath, allowPath);
          logForDebugging(`[Sandbox Linux] Re-allowed read access within denied region: ${allowPath}`);
        }
      }
    } else {
      if (readAllowPaths.includes(normalizedPath)) {
        logForDebugging(`[Sandbox Linux] Skipping read deny for re-allowed path: ${normalizedPath}`);
        continue;
      }
      args.push("--ro-bind", "/dev/null", normalizedPath);
      maskedFiles.add(normalizedPath);
    }
  }
  for (let i = 0; i < denyWriteArgs.length; i += 3) {
    const dest = denyWriteArgs[i + 2];
    if (maskedFiles.has(dest))
      continue;
    args.push(denyWriteArgs[i], denyWriteArgs[i + 1], dest);
  }
  return args;
}
async function wrapCommandWithSandboxLinux(params) {
  const { command, needsNetworkRestriction, httpSocketPath, socksSocketPath, httpProxyPort, socksProxyPort, readConfig, writeConfig, enableWeakerNestedSandbox, allowAllUnixSockets, binShell, ripgrepConfig = { command: "rg" }, mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH, allowGitConfig = false, seccompConfig, abortSignal } = params;
  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== void 0;
  if (!needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return command;
  }
  activeSandboxCount++;
  const bwrapArgs = ["--new-session", "--die-with-parent"];
  let applySeccompPrefix;
  try {
    if (!allowAllUnixSockets) {
      applySeccompPrefix = resolveApplySeccompPrefix(seccompConfig?.applyPath, seccompConfig?.argv0);
      if (!applySeccompPrefix) {
        logForDebugging("[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled. Install @anthropic-ai/sandbox-runtime globally for full protection.", { level: "warn" });
      } else {
        logForDebugging("[Sandbox Linux] Applying seccomp filter for Unix socket blocking");
      }
    } else {
      logForDebugging("[Sandbox Linux] Skipping seccomp filter - allowAllUnixSockets is enabled");
    }
    if (needsNetworkRestriction) {
      bwrapArgs.push("--unshare-net");
      if (httpSocketPath && socksSocketPath) {
        if (!fs4.existsSync(httpSocketPath)) {
          throw new Error(`Linux HTTP bridge socket does not exist: ${httpSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`);
        }
        if (!fs4.existsSync(socksSocketPath)) {
          throw new Error(`Linux SOCKS bridge socket does not exist: ${socksSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`);
        }
        bwrapArgs.push("--bind", httpSocketPath, httpSocketPath);
        bwrapArgs.push("--bind", socksSocketPath, socksSocketPath);
        const proxyEnv = generateProxyEnvVars(
          3128,
          // Internal HTTP listener port
          1080
        );
        bwrapArgs.push(...proxyEnv.flatMap((env) => {
          const firstEq = env.indexOf("=");
          const key = env.slice(0, firstEq);
          const value = env.slice(firstEq + 1);
          return ["--setenv", key, value];
        }));
        if (httpProxyPort !== void 0) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_HTTP_PROXY_PORT", String(httpProxyPort));
        }
        if (socksProxyPort !== void 0) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_SOCKS_PROXY_PORT", String(socksProxyPort));
        }
      }
    }
    const fsArgs = await generateFilesystemArgs(readConfig, writeConfig, ripgrepConfig, mandatoryDenySearchDepth, allowGitConfig, abortSignal);
    bwrapArgs.push(...fsArgs);
    bwrapArgs.push("--dev", "/dev");
    bwrapArgs.push("--unshare-pid");
    if (!enableWeakerNestedSandbox) {
      bwrapArgs.push("--proc", "/proc");
    } else {
      bwrapArgs.push("--unshare-user", "--bind", "/proc", "/proc");
    }
    const shellName = binShell || "bash";
    const shell = whichSync(shellName);
    if (!shell) {
      throw new Error(`Shell '${shellName}' not found in PATH`);
    }
    bwrapArgs.push("--", shell, "-c");
    if (needsNetworkRestriction && httpSocketPath && socksSocketPath) {
      const sandboxCommand = buildSandboxCommand(httpSocketPath, socksSocketPath, command, applySeccompPrefix, shell);
      bwrapArgs.push(sandboxCommand);
    } else if (applySeccompPrefix) {
      const applySeccompCmd = applySeccompPrefix + import_shell_quote.default.quote([shell, "-c", command]);
      bwrapArgs.push(applySeccompCmd);
    } else {
      bwrapArgs.push(command);
    }
    const wrappedCommand = import_shell_quote.default.quote(["bwrap", ...bwrapArgs]);
    const restrictions = [];
    if (needsNetworkRestriction)
      restrictions.push("network");
    if (hasReadRestrictions || hasWriteRestrictions)
      restrictions.push("filesystem");
    if (applySeccompPrefix)
      restrictions.push("seccomp(unix-block)");
    logForDebugging(`[Sandbox Linux] Wrapped command with bwrap (${restrictions.join(", ")} restrictions)`);
    return wrappedCommand;
  } catch (error) {
    if (activeSandboxCount > 0) {
      activeSandboxCount--;
    }
    throw error;
  }
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/macos-sandbox-utils.js
var import_shell_quote2 = __toESM(require_shell_quote(), 1);
import { spawn as spawn3 } from "child_process";
import * as path3 from "path";
function macGetMandatoryDenyPatterns(allowGitConfig = false) {
  const cwd = process.cwd();
  const denyPaths = [];
  for (const fileName of DANGEROUS_FILES) {
    denyPaths.push(path3.resolve(cwd, fileName));
    denyPaths.push(`**/${fileName}`);
  }
  for (const dirName of getDangerousDirectories()) {
    denyPaths.push(path3.resolve(cwd, dirName));
    denyPaths.push(`**/${dirName}/**`);
  }
  denyPaths.push(path3.resolve(cwd, ".git/hooks"));
  denyPaths.push("**/.git/hooks/**");
  if (!allowGitConfig) {
    denyPaths.push(path3.resolve(cwd, ".git/config"));
    denyPaths.push("**/.git/config");
  }
  return [...new Set(denyPaths)];
}
var sessionSuffix = `_${Math.random().toString(36).slice(2, 11)}_SBX`;
function generateLogTag(command) {
  const encodedCommand = encodeSandboxedCommand(command);
  return `CMD64_${encodedCommand}_END_${sessionSuffix}`;
}
function getAncestorDirectories(pathStr) {
  const ancestors = [];
  let currentPath = path3.dirname(pathStr);
  while (currentPath !== "/" && currentPath !== ".") {
    ancestors.push(currentPath);
    const parentPath = path3.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    currentPath = parentPath;
  }
  return ancestors;
}
function generateMoveBlockingRules(pathPatterns, logTag) {
  const rules = [];
  const ops = ["file-write-unlink", "file-write-create"];
  for (const pathPattern of pathPatterns) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      for (const op of ops) {
        rules.push(`(deny ${op}`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
      }
      const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
      if (staticPrefix && staticPrefix !== "/") {
        const baseDir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : path3.dirname(staticPrefix);
        for (const op of ops) {
          rules.push(`(deny ${op}`, `  (literal ${escapePath(baseDir)})`, `  (with message "${logTag}"))`);
        }
        for (const ancestorDir of getAncestorDirectories(baseDir)) {
          for (const op of ops) {
            rules.push(`(deny ${op}`, `  (literal ${escapePath(ancestorDir)})`, `  (with message "${logTag}"))`);
          }
        }
      }
    } else {
      for (const op of ops) {
        rules.push(`(deny ${op}`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
      }
      for (const ancestorDir of getAncestorDirectories(normalizedPath)) {
        for (const op of ops) {
          rules.push(`(deny ${op}`, `  (literal ${escapePath(ancestorDir)})`, `  (with message "${logTag}"))`);
        }
      }
    }
  }
  return rules;
}
function generateReadRules(config2, logTag, writeAllowPaths) {
  if (!config2) {
    return [`(allow file-read*)`];
  }
  const rules = [];
  let deniesRoot = false;
  rules.push(`(allow file-read*)`);
  for (const pathPattern of config2.denyOnly || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (normalizedPath === "/")
      deniesRoot = true;
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(`(deny file-read*`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
    } else {
      rules.push(`(deny file-read*`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
    }
  }
  if (deniesRoot) {
    rules.push(`(allow file-read* (literal "/"))`);
  }
  for (const pathPattern of config2.allowWithinDeny || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(`(allow file-read*`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
    } else {
      rules.push(`(allow file-read*`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
    }
  }
  if (config2.denyOnly.length > 0) {
    rules.push(`(allow file-read-metadata`, `  (vnode-type DIRECTORY))`);
  }
  rules.push(...generateMoveBlockingRules(config2.denyOnly || [], logTag));
  if (writeAllowPaths && writeAllowPaths.length > 0) {
    for (const pathPattern of writeAllowPaths) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      for (const op of ["file-write-unlink", "file-write-create"]) {
        if (containsGlobChars(normalizedPath)) {
          const regexPattern = globToRegex(normalizedPath);
          rules.push(`(allow ${op}`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
        } else {
          rules.push(`(allow ${op}`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
        }
      }
    }
  }
  return rules;
}
function generateWriteRules(config2, logTag, allowGitConfig = false) {
  if (!config2) {
    return [`(allow file-write*)`];
  }
  const rules = [];
  for (const pathPattern of config2.allowOnly || []) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(`(allow file-write*`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
    } else {
      rules.push(`(allow file-write*`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
    }
  }
  const denyPaths = [
    ...config2.denyWithinAllow || [],
    ...macGetMandatoryDenyPatterns(allowGitConfig)
  ];
  for (const pathPattern of denyPaths) {
    const normalizedPath = normalizePathForSandbox(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(`(deny file-write*`, `  (regex ${escapePath(regexPattern)})`, `  (with message "${logTag}"))`);
    } else {
      rules.push(`(deny file-write*`, `  (subpath ${escapePath(normalizedPath)})`, `  (with message "${logTag}"))`);
    }
  }
  rules.push(...generateMoveBlockingRules(denyPaths, logTag));
  return rules;
}
function generateSandboxProfile({ readConfig, writeConfig, httpProxyPort, socksProxyPort, needsNetworkRestriction, allowUnixSockets, allowAllUnixSockets, allowLocalBinding, allowMachLookup, allowPty, allowBrowserProcess = false, allowGitConfig = false, enableWeakerNetworkIsolation = false, logTag }) {
  const profile = [
    "(version 1)",
    `(deny default (with message "${logTag}"))`,
    "",
    `; LogTag: ${logTag}`,
    "",
    "; Essential permissions - based on Chrome sandbox policy",
    "; Process permissions",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow mach-priv-task-port (target same-sandbox))",
    "",
    "; User preferences",
    "(allow user-preference-read)",
    "",
    "; Mach IPC - specific services only (no wildcard)",
    "(allow mach-lookup",
    '  (global-name "com.apple.audio.systemsoundserver")',
    '  (global-name "com.apple.distributed_notifications@Uv3")',
    '  (global-name "com.apple.FontObjectsServer")',
    '  (global-name "com.apple.fonts")',
    '  (global-name "com.apple.logd")',
    '  (global-name "com.apple.lsd.mapdb")',
    '  (global-name "com.apple.PowerManagement.control")',
    '  (global-name "com.apple.system.logger")',
    '  (global-name "com.apple.system.notification_center")',
    '  (global-name "com.apple.system.opendirectoryd.libinfo")',
    '  (global-name "com.apple.system.opendirectoryd.membership")',
    '  (global-name "com.apple.bsd.dirhelper")',
    '  (global-name "com.apple.securityd.xpc")',
    '  (global-name "com.apple.coreservices.launchservicesd")',
    ")",
    "",
    ...enableWeakerNetworkIsolation ? [
      "; trustd.agent - needed for Go TLS certificate verification (weaker network isolation)",
      '(allow mach-lookup (global-name "com.apple.trustd.agent"))',
      "; configd - needed for Rust/Go programs that query system proxy/network config (uv, cargo)",
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd"))'
    ] : [],
    ...allowMachLookup && allowMachLookup.length > 0 ? [
      "; User-specified XPC/Mach services",
      ...allowMachLookup.map((name) => name.endsWith("*") ? `(allow mach-lookup (global-name-prefix ${escapePath(name.slice(0, -1))}))` : `(allow mach-lookup (global-name ${escapePath(name)}))`)
    ] : [],
    "",
    "; POSIX IPC - shared memory",
    "(allow ipc-posix-shm)",
    "",
    "; POSIX IPC - semaphores for Python multiprocessing",
    "(allow ipc-posix-sem)",
    "",
    "; IOKit - specific operations only",
    "(allow iokit-open",
    '  (iokit-registry-entry-class "IOSurfaceRootUserClient")',
    '  (iokit-registry-entry-class "RootDomainUserClient")',
    '  (iokit-user-client-class "IOSurfaceSendRight")',
    ")",
    "",
    "; IOKit properties",
    "(allow iokit-get-properties)",
    "",
    "; Specific safe system-sockets, doesn't allow network access",
    "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))",
    "",
    "; sysctl - specific sysctls only",
    "(allow sysctl-read",
    '  (sysctl-name "hw.activecpu")',
    '  (sysctl-name "hw.busfrequency_compat")',
    '  (sysctl-name "hw.byteorder")',
    '  (sysctl-name "hw.cacheconfig")',
    '  (sysctl-name "hw.cachelinesize_compat")',
    '  (sysctl-name "hw.cpufamily")',
    '  (sysctl-name "hw.cpufrequency")',
    '  (sysctl-name "hw.cpufrequency_compat")',
    '  (sysctl-name "hw.cputype")',
    '  (sysctl-name "hw.l1dcachesize_compat")',
    '  (sysctl-name "hw.l1icachesize_compat")',
    '  (sysctl-name "hw.l2cachesize_compat")',
    '  (sysctl-name "hw.l3cachesize_compat")',
    '  (sysctl-name "hw.logicalcpu")',
    '  (sysctl-name "hw.logicalcpu_max")',
    '  (sysctl-name "hw.machine")',
    '  (sysctl-name "hw.memsize")',
    '  (sysctl-name "hw.ncpu")',
    '  (sysctl-name "hw.nperflevels")',
    '  (sysctl-name "hw.packages")',
    '  (sysctl-name "hw.pagesize_compat")',
    '  (sysctl-name "hw.pagesize")',
    '  (sysctl-name "hw.physicalcpu")',
    '  (sysctl-name "hw.physicalcpu_max")',
    '  (sysctl-name "hw.tbfrequency_compat")',
    '  (sysctl-name "hw.vectorunit")',
    '  (sysctl-name "kern.argmax")',
    '  (sysctl-name "kern.bootargs")',
    '  (sysctl-name "kern.hostname")',
    '  (sysctl-name "kern.maxfiles")',
    '  (sysctl-name "kern.maxfilesperproc")',
    '  (sysctl-name "kern.maxproc")',
    '  (sysctl-name "kern.ngroups")',
    '  (sysctl-name "kern.osproductversion")',
    '  (sysctl-name "kern.osrelease")',
    '  (sysctl-name "kern.ostype")',
    '  (sysctl-name "kern.osvariant_status")',
    '  (sysctl-name "kern.osversion")',
    '  (sysctl-name "kern.secure_kernel")',
    '  (sysctl-name "kern.tcsm_available")',
    '  (sysctl-name "kern.tcsm_enable")',
    '  (sysctl-name "kern.usrstack64")',
    '  (sysctl-name "kern.version")',
    '  (sysctl-name "kern.willshutdown")',
    '  (sysctl-name "machdep.cpu.brand_string")',
    '  (sysctl-name "machdep.ptrauth_enabled")',
    '  (sysctl-name "security.mac.lockdown_mode_state")',
    '  (sysctl-name "sysctl.proc_cputype")',
    '  (sysctl-name "vm.loadavg")',
    '  (sysctl-name-prefix "hw.optional.arm")',
    '  (sysctl-name-prefix "hw.optional.arm.")',
    '  (sysctl-name-prefix "hw.optional.armv8_")',
    '  (sysctl-name-prefix "hw.perflevel")',
    '  (sysctl-name-prefix "kern.proc.all")',
    '  (sysctl-name-prefix "kern.proc.pgrp.")',
    '  (sysctl-name-prefix "kern.proc.pid.")',
    '  (sysctl-name-prefix "machdep.cpu.")',
    '  (sysctl-name-prefix "net.routetable.")',
    ")",
    "",
    "; V8 thread calculations",
    "(allow sysctl-write",
    '  (sysctl-name "kern.tcsm_enable")',
    ")",
    "",
    "; Distributed notifications",
    "(allow distributed-notification-post)",
    "",
    "; Specific mach-lookup permissions for security operations",
    '(allow mach-lookup (global-name "com.apple.SecurityServer"))',
    "",
    "; File I/O on device files",
    '(allow file-ioctl (literal "/dev/null"))',
    '(allow file-ioctl (literal "/dev/zero"))',
    '(allow file-ioctl (literal "/dev/random"))',
    '(allow file-ioctl (literal "/dev/urandom"))',
    '(allow file-ioctl (literal "/dev/dtracehelper"))',
    '(allow file-ioctl (literal "/dev/tty"))',
    "",
    "(allow file-ioctl file-read-data file-write-data",
    "  (require-all",
    '    (literal "/dev/null")',
    "    (vnode-type CHARACTER-DEVICE)",
    "  )",
    ")",
    ""
  ];
  profile.push("; Network");
  if (!needsNetworkRestriction) {
    profile.push("(allow network*)");
  } else {
    if (allowLocalBinding) {
      profile.push('(allow network-bind (local ip "*:*"))');
      profile.push('(allow network-inbound (local ip "*:*"))');
      profile.push('(allow network-outbound (local ip "*:*"))');
    }
    if (allowAllUnixSockets) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      profile.push('(allow network-bind (local unix-socket (path-regex #"^/")))');
      profile.push('(allow network-outbound (remote unix-socket (path-regex #"^/")))');
    } else if (allowUnixSockets && allowUnixSockets.length > 0) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      for (const socketPath of allowUnixSockets) {
        const normalizedPath = normalizePathForSandbox(socketPath);
        profile.push(`(allow network-bind (local unix-socket (subpath ${escapePath(normalizedPath)})))`);
        profile.push(`(allow network-outbound (remote unix-socket (subpath ${escapePath(normalizedPath)})))`);
      }
    }
    if (httpProxyPort !== void 0) {
      profile.push(`(allow network-bind (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${httpProxyPort}"))`);
    }
    if (socksProxyPort !== void 0) {
      profile.push(`(allow network-bind (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${socksProxyPort}"))`);
    }
  }
  profile.push("");
  const writeAllowPaths = writeConfig?.allowOnly;
  profile.push("; File read");
  profile.push(...generateReadRules(readConfig, logTag, writeAllowPaths));
  profile.push("");
  profile.push("; File write");
  profile.push(...generateWriteRules(writeConfig, logTag, allowGitConfig));
  if (allowPty) {
    profile.push("");
    profile.push("; Pseudo-terminal (pty) support");
    profile.push("(allow pseudo-tty)");
    profile.push("(allow file-ioctl");
    profile.push('  (literal "/dev/ptmx")');
    profile.push('  (regex #"^/dev/ttys")');
    profile.push(")");
    profile.push("(allow file-read* file-write*");
    profile.push('  (literal "/dev/ptmx")');
    profile.push('  (regex #"^/dev/ttys")');
    profile.push(")");
  }
  if (allowBrowserProcess) {
    profile.push("");
    profile.push("; Browser process support (Chrome/Chromium)");
    profile.push("; All Mach operations \u2014 Chrome requires bootstrap registration");
    profile.push("; (Crashpad), service lookups (window server, CoreDisplay, GPU),");
    profile.push("; task ports, and cross-domain lookups that vary by OS version");
    profile.push("(allow mach*)");
    profile.push("");
    profile.push("; Process info for all processes \u2014 Chrome manages renderer, GPU,");
    profile.push("; utility, and crashpad child processes outside the same sandbox");
    profile.push("(allow process-info*)");
    profile.push("");
    profile.push("; Broader IOKit access \u2014 needed for GPU process and display management");
    profile.push("(allow iokit-open)");
    profile.push("");
    profile.push("; Shared memory with non-sandboxed processes (e.g. renderer \u2194 GPU)");
    profile.push("(allow ipc-posix-shm*)");
  }
  return profile.join("\n");
}
function escapePath(pathStr) {
  return JSON.stringify(pathStr);
}
function wrapCommandWithSandboxMacOS(params) {
  const { command, needsNetworkRestriction, httpProxyPort, socksProxyPort, allowUnixSockets, allowAllUnixSockets, allowLocalBinding, allowMachLookup, readConfig, writeConfig, allowPty, allowBrowserProcess = false, allowGitConfig = false, enableWeakerNetworkIsolation = false, binShell } = params;
  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== void 0;
  if (!needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return command;
  }
  const logTag = generateLogTag(command);
  const profile = generateSandboxProfile({
    readConfig,
    writeConfig,
    httpProxyPort,
    socksProxyPort,
    needsNetworkRestriction,
    allowUnixSockets,
    allowAllUnixSockets,
    allowLocalBinding,
    allowMachLookup,
    allowPty,
    allowBrowserProcess,
    allowGitConfig,
    enableWeakerNetworkIsolation,
    logTag
  });
  const proxyEnvArgs = generateProxyEnvVars(httpProxyPort, socksProxyPort);
  const shellName = binShell || "bash";
  const shell = whichSync(shellName);
  if (!shell) {
    throw new Error(`Shell '${shellName}' not found in PATH`);
  }
  const wrappedCommand = import_shell_quote2.default.quote([
    "env",
    ...proxyEnvArgs,
    "sandbox-exec",
    "-p",
    profile,
    shell,
    "-c",
    command
  ]);
  logForDebugging(`[Sandbox macOS] Applied restrictions - network: ${!!(httpProxyPort || socksProxyPort)}, read: ${readConfig ? "allowAllExcept" in readConfig ? "allowAllExcept" : "denyAllExcept" : "none"}, write: ${writeConfig ? "allowAllExcept" in writeConfig ? "allowAllExcept" : "denyAllExcept" : "none"}`);
  return wrappedCommand;
}
function startMacOSSandboxLogMonitor(callback, ignoreViolations) {
  const cmdExtractRegex = /CMD64_(.+?)_END/;
  const sandboxExtractRegex = /Sandbox:\s+(.+)$/;
  const wildcardPaths = ignoreViolations?.["*"] || [];
  const commandPatterns = ignoreViolations ? Object.entries(ignoreViolations).filter(([pattern]) => pattern !== "*") : [];
  const logProcess = spawn3("log", [
    "stream",
    "--predicate",
    `(eventMessage ENDSWITH "${sessionSuffix}")`,
    "--style",
    "compact"
  ]);
  logProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n");
    const violationLine = lines.find((line) => line.includes("Sandbox:") && line.includes("deny"));
    const commandLine = lines.find((line) => line.startsWith("CMD64_"));
    if (!violationLine)
      return;
    const sandboxMatch = violationLine.match(sandboxExtractRegex);
    if (!sandboxMatch?.[1])
      return;
    const violationDetails = sandboxMatch[1];
    let command;
    let encodedCommand;
    if (commandLine) {
      const cmdMatch = commandLine.match(cmdExtractRegex);
      encodedCommand = cmdMatch?.[1];
      if (encodedCommand) {
        try {
          command = decodeSandboxedCommand(encodedCommand);
        } catch {
        }
      }
    }
    if (violationDetails.includes("mDNSResponder") || violationDetails.includes("mach-lookup com.apple.diagnosticd") || violationDetails.includes("mach-lookup com.apple.analyticsd")) {
      return;
    }
    if (ignoreViolations && command) {
      if (wildcardPaths.length > 0) {
        const shouldIgnore = wildcardPaths.some((path6) => violationDetails.includes(path6));
        if (shouldIgnore)
          return;
      }
      for (const [pattern, paths] of commandPatterns) {
        if (command.includes(pattern)) {
          const shouldIgnore = paths.some((path6) => violationDetails.includes(path6));
          if (shouldIgnore)
            return;
        }
      }
    }
    callback({
      line: violationDetails,
      command,
      encodedCommand,
      timestamp: /* @__PURE__ */ new Date()
      // We could parse the timestamp from the log but this feels more reliable
    });
  });
  logProcess.stderr?.on("data", (data) => {
    logForDebugging(`[Sandbox Monitor] Log stream stderr: ${data.toString()}`);
  });
  logProcess.on("error", (error) => {
    logForDebugging(`[Sandbox Monitor] Failed to start log stream: ${error.message}`);
  });
  logProcess.on("exit", (code) => {
    logForDebugging(`[Sandbox Monitor] Log stream exited with code: ${code}`);
  });
  return () => {
    logForDebugging("[Sandbox Monitor] Stopping log monitor");
    logProcess.kill("SIGTERM");
  };
}

// node_modules/@carderne/sandbox-runtime/dist/sandbox/sandbox-violation-store.js
var SandboxViolationStore = class {
  constructor() {
    this.violations = [];
    this.totalCount = 0;
    this.maxSize = 100;
    this.listeners = /* @__PURE__ */ new Set();
  }
  addViolation(violation) {
    this.violations.push(violation);
    this.totalCount++;
    if (this.violations.length > this.maxSize) {
      this.violations = this.violations.slice(-this.maxSize);
    }
    this.notifyListeners();
  }
  getViolations(limit) {
    if (limit === void 0) {
      return [...this.violations];
    }
    return this.violations.slice(-limit);
  }
  getCount() {
    return this.violations.length;
  }
  getTotalCount() {
    return this.totalCount;
  }
  getViolationsForCommand(command) {
    const commandBase64 = encodeSandboxedCommand(command);
    return this.violations.filter((v) => v.encodedCommand === commandBase64);
  }
  clear() {
    this.violations = [];
    this.notifyListeners();
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.getViolations());
    return () => {
      this.listeners.delete(listener);
    };
  }
  notifyListeners() {
    const violations = this.getViolations();
    this.listeners.forEach((listener) => listener(violations));
  }
};

// node_modules/@carderne/sandbox-runtime/dist/sandbox/sandbox-manager.js
import { isIP as isIP2 } from "node:net";
import { EOL } from "node:os";
var config;
var httpProxyServer;
var socksProxyServer;
var managerContext;
var initializationPromise;
var cleanupRegistered = false;
var logMonitorShutdown;
var parentProxy;
var sandboxViolationStore = new SandboxViolationStore();
function registerCleanup() {
  if (cleanupRegistered) {
    return;
  }
  const cleanupHandler = () => reset().catch((e) => {
    logForDebugging(`Cleanup failed in registerCleanup ${e}`, {
      level: "error"
    });
  });
  process.once("exit", cleanupHandler);
  process.once("SIGINT", cleanupHandler);
  process.once("SIGTERM", cleanupHandler);
  cleanupRegistered = true;
}
function matchesDomainPattern(hostname, pattern) {
  const h = hostname.toLowerCase();
  if (pattern.startsWith("*.")) {
    if (isIP2(stripBrackets(h)))
      return false;
    const baseDomain = pattern.substring(2).toLowerCase();
    return h.endsWith("." + baseDomain);
  }
  return h === pattern.toLowerCase();
}
async function filterNetworkRequest(port, host, sandboxAskCallback) {
  if (!config) {
    logForDebugging("No config available, denying network request");
    return false;
  }
  if (!isValidHost(host)) {
    logForDebugging(`Denying malformed host: ${JSON.stringify(host)}:${port}`, {
      level: "error"
    });
    return false;
  }
  const canonicalHost = canonicalizeHost(host) ?? host;
  for (const deniedDomain of config.network.deniedDomains) {
    if (matchesDomainPattern(canonicalHost, deniedDomain)) {
      logForDebugging(`Denied by config rule: ${host}:${port}`);
      return false;
    }
  }
  for (const allowedDomain of config.network.allowedDomains) {
    if (matchesDomainPattern(canonicalHost, allowedDomain)) {
      logForDebugging(`Allowed by config rule: ${host}:${port}`);
      return true;
    }
  }
  if (!sandboxAskCallback) {
    logForDebugging(`No matching config rule, denying: ${host}:${port}`);
    return false;
  }
  logForDebugging(`No matching config rule, asking user: ${host}:${port}`);
  try {
    const userAllowed = await sandboxAskCallback({ host, port });
    if (userAllowed) {
      logForDebugging(`User allowed: ${host}:${port}`);
      return true;
    } else {
      logForDebugging(`User denied: ${host}:${port}`);
      return false;
    }
  } catch (error) {
    logForDebugging(`Error in permission callback: ${error}`, {
      level: "error"
    });
    return false;
  }
}
function getMitmSocketPath(host) {
  if (!config?.network.mitmProxy) {
    return void 0;
  }
  const { socketPath, domains } = config.network.mitmProxy;
  for (const pattern of domains) {
    if (matchesDomainPattern(host, pattern)) {
      logForDebugging(`Host ${host} matches MITM pattern ${pattern}`);
      return socketPath;
    }
  }
  return void 0;
}
async function startHttpProxyServer(sandboxAskCallback) {
  httpProxyServer = createHttpProxyServer({
    filter: (port, host) => filterNetworkRequest(port, host, sandboxAskCallback),
    getMitmSocketPath,
    parentProxy
  });
  return new Promise((resolve5, reject) => {
    if (!httpProxyServer) {
      reject(new Error("HTTP proxy server undefined before listen"));
      return;
    }
    const server = httpProxyServer;
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        server.unref();
        logForDebugging(`HTTP proxy listening on localhost:${address.port}`);
        resolve5(address.port);
      } else {
        reject(new Error("Failed to get proxy server address"));
      }
    });
    server.listen(0, "127.0.0.1");
  });
}
async function startSocksProxyServer(sandboxAskCallback) {
  socksProxyServer = createSocksProxyServer({
    filter: (port, host) => filterNetworkRequest(port, host, sandboxAskCallback),
    parentProxy
  });
  return new Promise((resolve5, reject) => {
    if (!socksProxyServer) {
      reject(new Error("SOCKS proxy server undefined before listen"));
      return;
    }
    socksProxyServer.listen(0, "127.0.0.1").then((port) => {
      socksProxyServer?.unref();
      resolve5(port);
    }).catch(reject);
  });
}
async function initialize(runtimeConfig, sandboxAskCallback, enableLogMonitor = false) {
  if (initializationPromise) {
    await initializationPromise;
    return;
  }
  config = runtimeConfig;
  parentProxy = resolveParentProxy(runtimeConfig.network.parentProxy);
  if (parentProxy) {
    logForDebugging(`Parent proxy configured: http=${redactUrl(parentProxy.httpUrl)} https=${redactUrl(parentProxy.httpsUrl)}`);
  }
  const deps = checkDependencies();
  if (deps.errors.length > 0) {
    throw new Error(`Sandbox dependencies not available: ${deps.errors.join(", ")}`);
  }
  if (enableLogMonitor && getPlatform() === "macos") {
    logMonitorShutdown = startMacOSSandboxLogMonitor(sandboxViolationStore.addViolation.bind(sandboxViolationStore), config.ignoreViolations);
    logForDebugging("Started macOS sandbox log monitor");
  }
  registerCleanup();
  initializationPromise = (async () => {
    try {
      let httpProxyPort;
      if (config.network.httpProxyPort !== void 0) {
        httpProxyPort = config.network.httpProxyPort;
        logForDebugging(`Using external HTTP proxy on port ${httpProxyPort}`);
      } else {
        httpProxyPort = await startHttpProxyServer(sandboxAskCallback);
      }
      let socksProxyPort;
      if (config.network.socksProxyPort !== void 0) {
        socksProxyPort = config.network.socksProxyPort;
        logForDebugging(`Using external SOCKS proxy on port ${socksProxyPort}`);
      } else {
        socksProxyPort = await startSocksProxyServer(sandboxAskCallback);
      }
      let linuxBridge;
      if (getPlatform() === "linux") {
        linuxBridge = await initializeLinuxNetworkBridge(httpProxyPort, socksProxyPort);
      }
      const context = {
        httpProxyPort,
        socksProxyPort,
        linuxBridge
      };
      managerContext = context;
      logForDebugging("Network infrastructure initialized");
      return context;
    } catch (error) {
      initializationPromise = void 0;
      managerContext = void 0;
      reset().catch((e) => {
        logForDebugging(`Cleanup failed in initializationPromise ${e}`, {
          level: "error"
        });
      });
      throw error;
    }
  })();
  await initializationPromise;
}
function isSupportedPlatform() {
  const platform = getPlatform();
  if (platform === "linux") {
    return getWslVersion() !== "1";
  }
  return platform === "macos";
}
function isSandboxingEnabled() {
  return config !== void 0;
}
function checkDependencies(ripgrepConfig) {
  if (!isSupportedPlatform()) {
    return { errors: ["Unsupported platform"], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const rgToCheck = ripgrepConfig ?? config?.ripgrep ?? { command: "rg" };
  if (whichSync(rgToCheck.command) === null) {
    errors.push(`ripgrep (${rgToCheck.command}) not found`);
  }
  const platform = getPlatform();
  if (platform === "linux") {
    const linuxDeps = checkLinuxDependencies(config?.seccomp);
    errors.push(...linuxDeps.errors);
    warnings.push(...linuxDeps.warnings);
  }
  return { errors, warnings };
}
function getFsReadConfig() {
  if (!config) {
    return { denyOnly: [], allowWithinDeny: [] };
  }
  const denyPaths = [];
  for (const p of config.filesystem.denyRead) {
    const stripped = removeTrailingGlobSuffix(p);
    if (getPlatform() === "linux" && containsGlobChars(stripped)) {
      const expanded = expandGlobPattern(p);
      logForDebugging(`[Sandbox] Expanded glob pattern "${p}" to ${expanded.length} paths on Linux`);
      denyPaths.push(...expanded);
    } else {
      denyPaths.push(stripped);
    }
  }
  const allowPaths = [];
  for (const p of config.filesystem.allowRead ?? []) {
    const stripped = removeTrailingGlobSuffix(p);
    if (getPlatform() === "linux" && containsGlobChars(stripped)) {
      const expanded = expandGlobPattern(p);
      logForDebugging(`[Sandbox] Expanded allowRead glob pattern "${p}" to ${expanded.length} paths on Linux`);
      allowPaths.push(...expanded);
    } else {
      allowPaths.push(stripped);
    }
  }
  return {
    denyOnly: denyPaths,
    allowWithinDeny: allowPaths
  };
}
function getFsWriteConfig() {
  if (!config) {
    return { allowOnly: getDefaultWritePaths(), denyWithinAllow: [] };
  }
  const allowPaths = config.filesystem.allowWrite.map((path6) => removeTrailingGlobSuffix(path6)).filter((path6) => {
    if (getPlatform() === "linux" && containsGlobChars(path6)) {
      logForDebugging(`Skipping glob pattern on Linux/WSL: ${path6}`);
      return false;
    }
    return true;
  });
  const denyPaths = config.filesystem.denyWrite.map((path6) => removeTrailingGlobSuffix(path6)).filter((path6) => {
    if (getPlatform() === "linux" && containsGlobChars(path6)) {
      logForDebugging(`Skipping glob pattern on Linux/WSL: ${path6}`);
      return false;
    }
    return true;
  });
  const allowOnly = [...getDefaultWritePaths(), ...allowPaths];
  return {
    allowOnly,
    denyWithinAllow: denyPaths
  };
}
function getNetworkRestrictionConfig() {
  if (!config) {
    return {};
  }
  const allowedHosts = config.network.allowedDomains;
  const deniedHosts = config.network.deniedDomains;
  return {
    ...allowedHosts.length > 0 && { allowedHosts },
    ...deniedHosts.length > 0 && { deniedHosts }
  };
}
function getAllowUnixSockets() {
  return config?.network?.allowUnixSockets;
}
function getAllowAllUnixSockets() {
  return config?.network?.allowAllUnixSockets;
}
function getAllowLocalBinding() {
  return config?.network?.allowLocalBinding;
}
function getAllowMachLookup() {
  return config?.network?.allowMachLookup;
}
function getIgnoreViolations() {
  return config?.ignoreViolations;
}
function getEnableWeakerNestedSandbox() {
  return config?.enableWeakerNestedSandbox;
}
function getEnableWeakerNetworkIsolation() {
  return config?.enableWeakerNetworkIsolation;
}
function getRipgrepConfig() {
  return config?.ripgrep ?? { command: "rg" };
}
function getMandatoryDenySearchDepth() {
  return config?.mandatoryDenySearchDepth ?? 3;
}
function getAllowGitConfig() {
  return config?.filesystem?.allowGitConfig ?? false;
}
function getSeccompConfig() {
  return config?.seccomp;
}
function getProxyPort() {
  return managerContext?.httpProxyPort;
}
function getSocksProxyPort() {
  return managerContext?.socksProxyPort;
}
function getLinuxHttpSocketPath() {
  return managerContext?.linuxBridge?.httpSocketPath;
}
function getLinuxSocksSocketPath() {
  return managerContext?.linuxBridge?.socksSocketPath;
}
async function waitForNetworkInitialization() {
  if (!config) {
    return false;
  }
  if (initializationPromise) {
    try {
      await initializationPromise;
      return true;
    } catch {
      return false;
    }
  }
  return managerContext !== void 0;
}
async function wrapWithSandbox(command, binShell, customConfig, abortSignal) {
  const platform = getPlatform();
  const stripWriteGlobs = (paths) => paths.map((p) => removeTrailingGlobSuffix(p)).filter((p) => {
    if (getPlatform() === "linux" && containsGlobChars(p)) {
      logForDebugging(`[Sandbox] Skipping glob write pattern on Linux: ${p}`);
      return false;
    }
    return true;
  });
  const userAllowWrite = stripWriteGlobs(customConfig?.filesystem?.allowWrite ?? config?.filesystem.allowWrite ?? []);
  const writeConfig = {
    allowOnly: [...getDefaultWritePaths(), ...userAllowWrite],
    denyWithinAllow: stripWriteGlobs(customConfig?.filesystem?.denyWrite ?? config?.filesystem.denyWrite ?? [])
  };
  const rawDenyRead = customConfig?.filesystem?.denyRead ?? config?.filesystem.denyRead ?? [];
  const expandedDenyRead = [];
  for (const p of rawDenyRead) {
    const stripped = removeTrailingGlobSuffix(p);
    if (getPlatform() === "linux" && containsGlobChars(stripped)) {
      expandedDenyRead.push(...expandGlobPattern(p));
    } else {
      expandedDenyRead.push(stripped);
    }
  }
  const rawAllowRead = customConfig?.filesystem?.allowRead ?? config?.filesystem.allowRead ?? [];
  const expandedAllowRead = [];
  for (const p of rawAllowRead) {
    const stripped = removeTrailingGlobSuffix(p);
    if (getPlatform() === "linux" && containsGlobChars(stripped)) {
      expandedAllowRead.push(...expandGlobPattern(p));
    } else {
      expandedAllowRead.push(stripped);
    }
  }
  const readConfig = {
    denyOnly: expandedDenyRead,
    allowWithinDeny: expandedAllowRead
  };
  const hasNetworkConfig = customConfig?.network?.allowedDomains !== void 0 || config?.network?.allowedDomains !== void 0;
  const needsNetworkRestriction = hasNetworkConfig;
  const needsNetworkProxy = hasNetworkConfig;
  if (needsNetworkProxy) {
    await waitForNetworkInitialization();
  }
  const allowPty = customConfig?.allowPty ?? config?.allowPty;
  const allowBrowserProcess = customConfig?.allowBrowserProcess ?? config?.allowBrowserProcess;
  switch (platform) {
    case "macos":
      return wrapCommandWithSandboxMacOS({
        command,
        needsNetworkRestriction,
        // Only pass proxy ports if proxy is running (when there are domains to filter)
        httpProxyPort: needsNetworkProxy ? getProxyPort() : void 0,
        socksProxyPort: needsNetworkProxy ? getSocksProxyPort() : void 0,
        readConfig,
        writeConfig,
        allowUnixSockets: getAllowUnixSockets(),
        allowAllUnixSockets: getAllowAllUnixSockets(),
        allowLocalBinding: getAllowLocalBinding(),
        allowMachLookup: getAllowMachLookup(),
        ignoreViolations: getIgnoreViolations(),
        allowPty,
        allowBrowserProcess,
        allowGitConfig: getAllowGitConfig(),
        enableWeakerNetworkIsolation: getEnableWeakerNetworkIsolation(),
        binShell
      });
    case "linux":
      return wrapCommandWithSandboxLinux({
        command,
        needsNetworkRestriction,
        // Only pass socket paths if proxy is running (when there are domains to filter)
        httpSocketPath: needsNetworkProxy ? getLinuxHttpSocketPath() : void 0,
        socksSocketPath: needsNetworkProxy ? getLinuxSocksSocketPath() : void 0,
        httpProxyPort: needsNetworkProxy ? managerContext?.httpProxyPort : void 0,
        socksProxyPort: needsNetworkProxy ? managerContext?.socksProxyPort : void 0,
        readConfig,
        writeConfig,
        enableWeakerNestedSandbox: getEnableWeakerNestedSandbox(),
        allowAllUnixSockets: getAllowAllUnixSockets(),
        binShell,
        ripgrepConfig: getRipgrepConfig(),
        mandatoryDenySearchDepth: getMandatoryDenySearchDepth(),
        allowGitConfig: getAllowGitConfig(),
        seccompConfig: getSeccompConfig(),
        abortSignal
      });
    default:
      throw new Error(`Sandbox configuration is not supported on platform: ${platform}`);
  }
}
function getConfig() {
  return config;
}
function updateConfig(newConfig) {
  config = structuredClone(newConfig);
  parentProxy = resolveParentProxy(newConfig.network.parentProxy);
  logForDebugging("Sandbox configuration updated");
}
function cleanupAfterCommand() {
  cleanupBwrapMountPoints();
}
async function reset() {
  cleanupBwrapMountPoints({ force: true });
  if (logMonitorShutdown) {
    logMonitorShutdown();
    logMonitorShutdown = void 0;
  }
  if (managerContext?.linuxBridge) {
    const { httpSocketPath, socksSocketPath, httpBridgeProcess, socksBridgeProcess } = managerContext.linuxBridge;
    const exitPromises = [];
    if (httpBridgeProcess.pid && !httpBridgeProcess.killed) {
      try {
        process.kill(httpBridgeProcess.pid, "SIGTERM");
        logForDebugging("Sent SIGTERM to HTTP bridge process");
        exitPromises.push(new Promise((resolve5) => {
          httpBridgeProcess.once("exit", () => {
            logForDebugging("HTTP bridge process exited");
            resolve5();
          });
          setTimeout(() => {
            if (!httpBridgeProcess.killed) {
              logForDebugging("HTTP bridge did not exit, forcing SIGKILL", {
                level: "warn"
              });
              try {
                if (httpBridgeProcess.pid) {
                  process.kill(httpBridgeProcess.pid, "SIGKILL");
                }
              } catch {
              }
            }
            resolve5();
          }, 5e3);
        }));
      } catch (err) {
        if (err.code !== "ESRCH") {
          logForDebugging(`Error killing HTTP bridge: ${err}`, {
            level: "error"
          });
        }
      }
    }
    if (socksBridgeProcess.pid && !socksBridgeProcess.killed) {
      try {
        process.kill(socksBridgeProcess.pid, "SIGTERM");
        logForDebugging("Sent SIGTERM to SOCKS bridge process");
        exitPromises.push(new Promise((resolve5) => {
          socksBridgeProcess.once("exit", () => {
            logForDebugging("SOCKS bridge process exited");
            resolve5();
          });
          setTimeout(() => {
            if (!socksBridgeProcess.killed) {
              logForDebugging("SOCKS bridge did not exit, forcing SIGKILL", {
                level: "warn"
              });
              try {
                if (socksBridgeProcess.pid) {
                  process.kill(socksBridgeProcess.pid, "SIGKILL");
                }
              } catch {
              }
            }
            resolve5();
          }, 5e3);
        }));
      } catch (err) {
        if (err.code !== "ESRCH") {
          logForDebugging(`Error killing SOCKS bridge: ${err}`, {
            level: "error"
          });
        }
      }
    }
    await Promise.all(exitPromises);
    if (httpSocketPath) {
      try {
        fs5.rmSync(httpSocketPath, { force: true });
        logForDebugging("Cleaned up HTTP socket");
      } catch (err) {
        logForDebugging(`HTTP socket cleanup error: ${err}`, {
          level: "error"
        });
      }
    }
    if (socksSocketPath) {
      try {
        fs5.rmSync(socksSocketPath, { force: true });
        logForDebugging("Cleaned up SOCKS socket");
      } catch (err) {
        logForDebugging(`SOCKS socket cleanup error: ${err}`, {
          level: "error"
        });
      }
    }
  }
  const closePromises = [];
  if (httpProxyServer) {
    const server = httpProxyServer;
    const httpClose = new Promise((resolve5) => {
      server.close((error) => {
        if (error && error.message !== "Server is not running.") {
          logForDebugging(`Error closing HTTP proxy server: ${error.message}`, {
            level: "error"
          });
        }
        resolve5();
      });
    });
    closePromises.push(httpClose);
  }
  if (socksProxyServer) {
    const socksClose = socksProxyServer.close().catch((error) => {
      logForDebugging(`Error closing SOCKS proxy server: ${error.message}`, {
        level: "error"
      });
    });
    closePromises.push(socksClose);
  }
  await Promise.all(closePromises);
  httpProxyServer = void 0;
  socksProxyServer = void 0;
  managerContext = void 0;
  initializationPromise = void 0;
  parentProxy = void 0;
}
function getSandboxViolationStore() {
  return sandboxViolationStore;
}
function annotateStderrWithSandboxFailures(command, stderr) {
  if (!config) {
    return stderr;
  }
  const violations = sandboxViolationStore.getViolationsForCommand(command);
  if (violations.length === 0) {
    return stderr;
  }
  let annotated = stderr;
  annotated += EOL + "<sandbox_violations>" + EOL;
  for (const violation of violations) {
    annotated += violation.line + EOL;
  }
  annotated += "</sandbox_violations>";
  return annotated;
}
function getLinuxGlobPatternWarnings() {
  if (getPlatform() !== "linux" || !config) {
    return [];
  }
  const globPatterns = [];
  const allPaths = [
    ...config.filesystem.allowWrite,
    ...config.filesystem.denyWrite
  ];
  for (const path6 of allPaths) {
    const pathWithoutTrailingStar = removeTrailingGlobSuffix(path6);
    if (containsGlobChars(pathWithoutTrailingStar)) {
      globPatterns.push(path6);
    }
  }
  return globPatterns;
}
var SandboxManager = {
  initialize,
  isSupportedPlatform,
  isSandboxingEnabled,
  checkDependencies,
  getFsReadConfig,
  getFsWriteConfig,
  getNetworkRestrictionConfig,
  getAllowUnixSockets,
  getAllowLocalBinding,
  getAllowMachLookup,
  getIgnoreViolations,
  getEnableWeakerNestedSandbox,
  getProxyPort,
  getSocksProxyPort,
  getLinuxHttpSocketPath,
  getLinuxSocksSocketPath,
  waitForNetworkInitialization,
  wrapWithSandbox,
  cleanupAfterCommand,
  reset,
  getSandboxViolationStore,
  annotateStderrWithSandboxFailures,
  getLinuxGlobPatternWarnings,
  getConfig,
  updateConfig
};

// node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return {
      ...first,
      ...second
      // second overwrites first
    };
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path: path6, errorMaps, issueData } = params;
  const fullPath = [...path6, ...issueData.path || []];
  const fullIssue = {
    ...issueData,
    path: fullPath
  };
  if (issueData.message !== void 0) {
    return {
      ...issueData,
      path: fullPath,
      message: issueData.message
    };
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return {
    ...issueData,
    path: fullPath,
    message: errorMessage
  };
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message?.message;
})(errorUtil || (errorUtil = {}));

// node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path6, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path6;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message ?? ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: message ?? required_error ?? ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: message ?? invalid_type_error ?? ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    const ctx = {
      common: {
        issues: [],
        async: params?.async ?? false,
        contextualErrorMap: params?.errorMap
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if (err?.message?.toLowerCase()?.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params?.errorMap,
        async: true
      },
      path: params?.path || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue({
        code: ZodIssueCode.custom,
        ...getIssueProperties(val)
      });
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects({
      ...processCreateParams(this._def),
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    });
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault({
      ...processCreateParams(this._def),
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    });
  }
  brand() {
    return new ZodBranded({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this,
      ...processCreateParams(this._def)
    });
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch({
      ...processCreateParams(this._def),
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    });
  }
  describe(description) {
    const This = this.constructor;
    return new This({
      ...this._def,
      description
    });
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && decoded?.typ !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), {
      validation,
      code: ZodIssueCode.invalid_string,
      ...errorUtil.errToObj(message)
    });
  }
  _addCheck(check) {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  email(message) {
    return this._addCheck({ kind: "email", ...errorUtil.errToObj(message) });
  }
  url(message) {
    return this._addCheck({ kind: "url", ...errorUtil.errToObj(message) });
  }
  emoji(message) {
    return this._addCheck({ kind: "emoji", ...errorUtil.errToObj(message) });
  }
  uuid(message) {
    return this._addCheck({ kind: "uuid", ...errorUtil.errToObj(message) });
  }
  nanoid(message) {
    return this._addCheck({ kind: "nanoid", ...errorUtil.errToObj(message) });
  }
  cuid(message) {
    return this._addCheck({ kind: "cuid", ...errorUtil.errToObj(message) });
  }
  cuid2(message) {
    return this._addCheck({ kind: "cuid2", ...errorUtil.errToObj(message) });
  }
  ulid(message) {
    return this._addCheck({ kind: "ulid", ...errorUtil.errToObj(message) });
  }
  base64(message) {
    return this._addCheck({ kind: "base64", ...errorUtil.errToObj(message) });
  }
  base64url(message) {
    return this._addCheck({
      kind: "base64url",
      ...errorUtil.errToObj(message)
    });
  }
  jwt(options) {
    return this._addCheck({ kind: "jwt", ...errorUtil.errToObj(options) });
  }
  ip(options) {
    return this._addCheck({ kind: "ip", ...errorUtil.errToObj(options) });
  }
  cidr(options) {
    return this._addCheck({ kind: "cidr", ...errorUtil.errToObj(options) });
  }
  datetime(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck({
      kind: "datetime",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      offset: options?.offset ?? false,
      local: options?.local ?? false,
      ...errorUtil.errToObj(options?.message)
    });
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck({
      kind: "time",
      precision: typeof options?.precision === "undefined" ? null : options?.precision,
      ...errorUtil.errToObj(options?.message)
    });
  }
  duration(message) {
    return this._addCheck({ kind: "duration", ...errorUtil.errToObj(message) });
  }
  regex(regex, message) {
    return this._addCheck({
      kind: "regex",
      regex,
      ...errorUtil.errToObj(message)
    });
  }
  includes(value, options) {
    return this._addCheck({
      kind: "includes",
      value,
      position: options?.position,
      ...errorUtil.errToObj(options?.message)
    });
  }
  startsWith(value, message) {
    return this._addCheck({
      kind: "startsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  endsWith(value, message) {
    return this._addCheck({
      kind: "endsWith",
      value,
      ...errorUtil.errToObj(message)
    });
  }
  min(minLength, message) {
    return this._addCheck({
      kind: "min",
      value: minLength,
      ...errorUtil.errToObj(message)
    });
  }
  max(maxLength, message) {
    return this._addCheck({
      kind: "max",
      value: maxLength,
      ...errorUtil.errToObj(message)
    });
  }
  length(len, message) {
    return this._addCheck({
      kind: "length",
      value: len,
      ...errorUtil.errToObj(message)
    });
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "trim" }]
    });
  }
  toLowerCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    });
  }
  toUpperCase() {
    return new _ZodString({
      ...this._def,
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    });
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  return new ZodString({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodNumber({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt({
      ...this._def,
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    });
  }
  _addCheck(check) {
    return new _ZodBigInt({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  return new ZodBigInt({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: params?.coerce ?? false,
    ...processCreateParams(params)
  });
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: params?.coerce || false,
    ...processCreateParams(params)
  });
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate({
      ...this._def,
      checks: [...this._def.checks, check]
    });
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate({
    checks: [],
    coerce: params?.coerce || false,
    typeName: ZodFirstPartyTypeKind.ZodDate,
    ...processCreateParams(params)
  });
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol({
    typeName: ZodFirstPartyTypeKind.ZodSymbol,
    ...processCreateParams(params)
  });
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined({
    typeName: ZodFirstPartyTypeKind.ZodUndefined,
    ...processCreateParams(params)
  });
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull({
    typeName: ZodFirstPartyTypeKind.ZodNull,
    ...processCreateParams(params)
  });
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny({
    typeName: ZodFirstPartyTypeKind.ZodAny,
    ...processCreateParams(params)
  });
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown({
    typeName: ZodFirstPartyTypeKind.ZodUnknown,
    ...processCreateParams(params)
  });
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever({
    typeName: ZodFirstPartyTypeKind.ZodNever,
    ...processCreateParams(params)
  });
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid({
    typeName: ZodFirstPartyTypeKind.ZodVoid,
    ...processCreateParams(params)
  });
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray({
      ...this._def,
      minLength: { value: minLength, message: errorUtil.toString(message) }
    });
  }
  max(maxLength, message) {
    return new _ZodArray({
      ...this._def,
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    });
  }
  length(len, message) {
    return new _ZodArray({
      ...this._def,
      exactLength: { value: len, message: errorUtil.toString(message) }
    });
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray,
    ...processCreateParams(params)
  });
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject({
      ...schema._def,
      shape: () => newShape
    });
  } else if (schema instanceof ZodArray) {
    return new ZodArray({
      ...schema._def,
      type: deepPartialify(schema.element)
    });
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strict",
      ...message !== void 0 ? {
        errorMap: (issue, ctx) => {
          const defaultError = this._def.errorMap?.(issue, ctx).message ?? ctx.defaultError;
          if (issue.code === "unrecognized_keys")
            return {
              message: errorUtil.errToObj(message).message ?? defaultError
            };
          return {
            message: defaultError
          };
        }
      } : {}
    });
  }
  strip() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "strip"
    });
  }
  passthrough() {
    return new _ZodObject({
      ...this._def,
      unknownKeys: "passthrough"
    });
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject({
      ...this._def,
      shape: () => ({
        ...this._def.shape(),
        ...augmentation
      })
    });
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => ({
        ...this._def.shape(),
        ...merging._def.shape()
      }),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject({
      ...this._def,
      catchall: index
    });
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => shape
    });
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject({
      ...this._def,
      shape: () => newShape
    });
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject,
    ...processCreateParams(params)
  });
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = {
          ...ctx,
          common: {
            ...ctx.common,
            issues: []
          },
          parent: null
        };
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion,
    ...processCreateParams(params)
  });
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap,
      ...processCreateParams(params)
    });
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection,
    ...processCreateParams(params)
  });
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple({
      ...this._def,
      rest
    });
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null,
    ...processCreateParams(params)
  });
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord,
        ...processCreateParams(third)
      });
    }
    return new _ZodRecord({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord,
      ...processCreateParams(second)
    });
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap,
    ...processCreateParams(params)
  });
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet({
      ...this._def,
      minSize: { value: minSize, message: errorUtil.toString(message) }
    });
  }
  max(maxSize, message) {
    return new _ZodSet({
      ...this._def,
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    });
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet,
    ...processCreateParams(params)
  });
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction({
      ...this._def,
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    });
  }
  returns(returnType) {
    return new _ZodFunction({
      ...this._def,
      returns: returnType
    });
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction,
      ...processCreateParams(params)
    });
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy,
    ...processCreateParams(params)
  });
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral,
    ...processCreateParams(params)
  });
};
function createZodEnum(values, params) {
  return new ZodEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum,
    ...processCreateParams(params)
  });
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, {
      ...this._def,
      ...newDef
    });
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), {
      ...this._def,
      ...newDef
    });
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum,
    ...processCreateParams(params)
  });
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise,
    ...processCreateParams(params)
  });
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect,
    ...processCreateParams(params)
  });
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    ...processCreateParams(params)
  });
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional,
    ...processCreateParams(params)
  });
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable,
    ...processCreateParams(params)
  });
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default,
    ...processCreateParams(params)
  });
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = {
      ...ctx,
      common: {
        ...ctx.common,
        issues: []
      }
    };
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: {
        ...newCtx
      }
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch,
    ...processCreateParams(params)
  });
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN({
    typeName: ZodFirstPartyTypeKind.ZodNaN,
    ...processCreateParams(params)
  });
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly,
    ...processCreateParams(params)
  });
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = params.fatal ?? fatal ?? true;
            ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = params.fatal ?? fatal ?? true;
        ctx.addIssue({ code: "custom", ...params, fatal: _fatal });
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create({ ...arg, coerce: true })),
  number: ((arg) => ZodNumber.create({ ...arg, coerce: true })),
  boolean: ((arg) => ZodBoolean.create({
    ...arg,
    coerce: true
  })),
  bigint: ((arg) => ZodBigInt.create({ ...arg, coerce: true })),
  date: ((arg) => ZodDate.create({ ...arg, coerce: true }))
};
var NEVER = INVALID;

// node_modules/@carderne/sandbox-runtime/dist/sandbox/sandbox-config.js
var domainPatternSchema = external_exports.string().refine((val) => {
  if (val.includes("://") || val.includes("/") || val.includes(":")) {
    return false;
  }
  if (val === "localhost")
    return true;
  if (val.startsWith("*.")) {
    const domain = val.slice(2);
    if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
      return false;
    }
    const parts = domain.split(".");
    return parts.length >= 2 && parts.every((p) => p.length > 0);
  }
  if (val.includes("*")) {
    return false;
  }
  return val.includes(".") && !val.startsWith(".") && !val.endsWith(".");
}, {
  message: 'Invalid domain pattern. Must be a valid domain (e.g., "example.com") or wildcard (e.g., "*.example.com"). Overly broad patterns like "*.com" or "*" are not allowed for security reasons.'
});
var filesystemPathSchema = external_exports.string().min(1, "Path cannot be empty");
var MitmProxyConfigSchema = external_exports.object({
  socketPath: external_exports.string().min(1).describe("Unix socket path to the MITM proxy"),
  domains: external_exports.array(domainPatternSchema).min(1).describe('Domains to route through the MITM proxy (e.g., ["api.example.com", "*.internal.org"])')
});
var ParentProxyConfigSchema = external_exports.object({
  http: external_exports.string().url().optional().describe("Upstream proxy URL for plain HTTP traffic"),
  https: external_exports.string().url().optional().describe("Upstream proxy URL for HTTPS/CONNECT traffic (falls back to http if unset)"),
  noProxy: external_exports.string().optional().describe("Comma-separated NO_PROXY list (hostname suffixes and CIDR ranges). Matching destinations connect directly instead of via the parent proxy.")
});
var NetworkConfigSchema = external_exports.object({
  allowedDomains: external_exports.array(domainPatternSchema).describe('List of allowed domains (e.g., ["github.com", "*.npmjs.org"])'),
  deniedDomains: external_exports.array(domainPatternSchema).describe("List of denied domains"),
  allowUnixSockets: external_exports.array(external_exports.string()).optional().describe("macOS only: Unix socket paths to allow. Ignored on Linux (seccomp cannot filter by path)."),
  allowAllUnixSockets: external_exports.boolean().optional().describe("If true, allow all Unix sockets (disables blocking on both platforms)."),
  allowLocalBinding: external_exports.boolean().optional().describe("Whether to allow binding to local ports (default: false)"),
  allowMachLookup: external_exports.array(external_exports.string().refine((val) => {
    const prefix = val.endsWith("*") ? val.slice(0, -1) : val;
    return !prefix.includes("*");
  }, {
    message: 'Wildcards are only allowed as a single trailing "*" (e.g., "com.example.*" or "*" for all services).'
  })).optional().describe('macOS only: Additional XPC/Mach service names to allow looking up. Supports trailing-wildcard prefix matching (e.g., "2BUA8C4S2C.com.1password.*"). Needed for tools like 1Password CLI, Playwright, or the iOS Simulator that communicate via XPC.'),
  httpProxyPort: external_exports.number().int().min(1).max(65535).optional().describe("Port of an external HTTP proxy to use instead of starting a local one. When provided, the library will skip starting its own HTTP proxy and use this port. The external proxy must handle domain filtering."),
  socksProxyPort: external_exports.number().int().min(1).max(65535).optional().describe("Port of an external SOCKS proxy to use instead of starting a local one. When provided, the library will skip starting its own SOCKS proxy and use this port. The external proxy must handle domain filtering."),
  mitmProxy: MitmProxyConfigSchema.optional().describe("Optional MITM proxy configuration. Routes matching domains through an upstream proxy via Unix socket while SRT still handles allow/deny filtering."),
  parentProxy: ParentProxyConfigSchema.optional().describe("Upstream HTTP proxy for outbound connections. When set, SRT's proxy tunnels non-mitmProxy traffic through this parent instead of connecting directly. Falls back to HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars if unset.")
});
var FilesystemConfigSchema = external_exports.object({
  denyRead: external_exports.array(filesystemPathSchema).describe("Paths denied for reading"),
  allowRead: external_exports.array(filesystemPathSchema).optional().describe("Paths to re-allow reading within denied regions (takes precedence over denyRead). Use with denyRead to deny a broad region then allow back specific subdirectories."),
  allowWrite: external_exports.array(filesystemPathSchema).describe("Paths allowed for writing"),
  denyWrite: external_exports.array(filesystemPathSchema).describe("Paths denied for writing (takes precedence over allowWrite)"),
  allowGitConfig: external_exports.boolean().optional().describe("Allow writes to .git/config files (default: false). Enables git remote URL updates while keeping .git/hooks protected.")
});
var IgnoreViolationsConfigSchema = external_exports.record(external_exports.string(), external_exports.array(external_exports.string())).describe('Map of command patterns to filesystem paths to ignore violations for. Use "*" to match all commands');
var RipgrepConfigSchema = external_exports.object({
  command: external_exports.string().describe("The ripgrep command to execute"),
  args: external_exports.array(external_exports.string()).optional().describe("Additional arguments to pass before ripgrep args"),
  argv0: external_exports.string().optional().describe("Override argv[0] when spawning (for multicall binaries that dispatch on argv[0])")
});
var SeccompConfigSchema = external_exports.object({
  applyPath: external_exports.string().optional().describe("Path to the apply-seccomp binary"),
  argv0: external_exports.string().optional().describe("Invoke apply-seccomp as a multicall binary that dispatches on the ARGV0 environment variable. When set, applyPath is used verbatim (no existence check) and the invocation inside bwrap is prefixed with ARGV0=<this value>. The caller is responsible for ensuring applyPath resolves inside the bwrap namespace and that the target binary implements the apply-seccomp interface when ARGV0 matches.")
});
var SandboxRuntimeConfigSchema = external_exports.object({
  network: NetworkConfigSchema.describe("Network restrictions configuration"),
  filesystem: FilesystemConfigSchema.describe("Filesystem restrictions configuration"),
  ignoreViolations: IgnoreViolationsConfigSchema.optional().describe("Optional configuration for ignoring specific violations"),
  enableWeakerNestedSandbox: external_exports.boolean().optional().describe("Enable weaker nested sandbox mode (for Docker environments)"),
  enableWeakerNetworkIsolation: external_exports.boolean().optional().describe("Enable weaker network isolation to allow access to com.apple.trustd.agent (macOS only). This is needed for Go programs (gh, gcloud, terraform, kubectl, etc.) to verify TLS certificates when using httpProxyPort with a MITM proxy and custom CA. Enabling this opens a potential data exfiltration vector through the trustd service. Only enable if you need Go TLS verification."),
  ripgrep: RipgrepConfigSchema.optional().describe('Custom ripgrep configuration (default: { command: "rg" })'),
  mandatoryDenySearchDepth: external_exports.number().int().min(1).max(10).optional().describe("Maximum directory depth to search for dangerous files on Linux (default: 3). Higher values provide more protection but slower performance."),
  allowPty: external_exports.boolean().optional().describe("Allow pseudo-terminal (pty) operations (macOS only)"),
  allowBrowserProcess: external_exports.boolean().optional().describe("Allow browser process operations (macOS only). Grants the additional Mach IPC, Mach bootstrap registration, and IOKit permissions that Chromium-based browsers need to launch and run inside the sandbox. Required for tools like agent-browser that spawn a Chrome/Chromium subprocess. Without this, Chrome will crash on startup due to denied Mach service lookups and bootstrap registrations."),
  seccomp: SeccompConfigSchema.optional().describe("Custom seccomp binary paths (Linux only).")
});

// src/index.ts
import {
  createBashToolDefinition as createBashToolDefinition2,
  getAgentDir,
  getShellConfig,
  isToolCallEventType,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { matchesKey, Key, truncateToWidth } from "@earendil-works/pi-tui";
import fsPromises from "node:fs/promises";

// ../bash-tool-coordinator.ts
import {
  createBashToolDefinition,
  createLocalBashOperations
} from "@earendil-works/pi-coding-agent";
var STATE_KEY = /* @__PURE__ */ Symbol.for("pi.extensions.bashToolCoordinator");
function getState() {
  const globalRecord = globalThis;
  globalRecord[STATE_KEY] ??= { plugins: /* @__PURE__ */ new Map() };
  return globalRecord[STATE_KEY];
}
function orderedPlugins(state) {
  return [...state.plugins.values()].sort(
    (a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id)
  );
}
function composeOperations(state) {
  let operations = createLocalBashOperations();
  for (const plugin of orderedPlugins(state)) {
    if (plugin.wrapOperations) operations = plugin.wrapOperations(operations);
  }
  return operations;
}
function composeRenderResult(state, baseRenderResult) {
  let renderResult = baseRenderResult;
  for (const plugin of orderedPlugins(state)) {
    if (plugin.wrapRenderResult) renderResult = plugin.wrapRenderResult(renderResult);
  }
  return renderResult;
}
function createComposedBashTool(cwd, state) {
  const base = createBashToolDefinition(cwd, { operations: composeOperations(state) });
  if (!base.renderResult) return base;
  return {
    ...base,
    renderResult: composeRenderResult(state, base.renderResult)
  };
}
function registerWithCurrentOwner(state) {
  if (!state.ownerPi || !state.cwd) return false;
  try {
    state.ownerPi.registerTool(createComposedBashTool(state.cwd, state));
    return true;
  } catch {
    state.ownerPi = void 0;
    state.cwd = void 0;
    return false;
  }
}
function registerBashToolPlugin(_pi, plugin) {
  const state = getState();
  state.plugins.set(plugin.id, plugin);
  registerWithCurrentOwner(state);
}
function ensureBashToolRegistered(pi, cwd) {
  const state = getState();
  state.cwd = cwd;
  if (!registerWithCurrentOwner(state)) {
    state.ownerPi = pi;
    state.cwd = cwd;
    state.ownerPi.registerTool(createComposedBashTool(cwd, state));
  }
}
function releaseBashToolOwner(pi) {
  const state = getState();
  if (state.ownerPi !== pi) return;
  state.ownerPi = void 0;
  state.cwd = void 0;
}

// src/direct-linux-sandbox.ts
import * as fs6 from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import path4 from "node:path";

// src/proxy-env-filter.ts
function omitNoProxyEnvVars(envVars) {
  return envVars.filter((envVar) => !envVar.toLowerCase().startsWith("no_proxy="));
}

// src/proxy-env.ts
function generateSandboxProxyEnvVars(httpProxyPort, socksProxyPort) {
  return omitNoProxyEnvVars(generateProxyEnvVars(httpProxyPort, socksProxyPort));
}

// src/direct-linux-sandbox.ts
var DEFAULT_MANDATORY_DENY_SEARCH_DEPTH2 = 3;
function findSymlinkInPath2(targetPath, allowedWritePaths) {
  const parts = targetPath.split(path4.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path4.sep + part;
    try {
      const stats = fs6.lstatSync(nextPath);
      if (stats.isSymbolicLink()) {
        const isWithinAllowedPath = allowedWritePaths.some(
          (allowedPath) => nextPath.startsWith(allowedPath + "/") || nextPath === allowedPath
        );
        if (isWithinAllowedPath) return nextPath;
      }
    } catch {
      break;
    }
    currentPath = nextPath;
  }
  return null;
}
function hasFileAncestor2(targetPath) {
  const parts = targetPath.split(path4.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path4.sep + part;
    try {
      const stat = fs6.statSync(nextPath);
      if (stat.isFile() || stat.isSymbolicLink()) return true;
    } catch {
      break;
    }
    currentPath = nextPath;
  }
  return false;
}
function findFirstNonExistentComponent2(targetPath) {
  const parts = targetPath.split(path4.sep);
  let currentPath = "";
  for (const part of parts) {
    if (!part) continue;
    const nextPath = currentPath + path4.sep + part;
    if (!fs6.existsSync(nextPath)) return nextPath;
    currentPath = nextPath;
  }
  return targetPath;
}
async function linuxGetMandatoryDenyPaths2(ripgrepConfig = { command: "rg" }, maxDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH2, allowGitConfig = false, abortSignal) {
  const cwd = process.cwd();
  const fallbackController = new AbortController();
  const signal = abortSignal ?? fallbackController.signal;
  const dangerousDirectories = getDangerousDirectories();
  const denyPaths = [
    ...DANGEROUS_FILES.map((fileName) => path4.resolve(cwd, fileName)),
    ...dangerousDirectories.map((dirName) => path4.resolve(cwd, dirName))
  ];
  const dotGitPath = path4.resolve(cwd, ".git");
  let dotGitIsDirectory = false;
  try {
    dotGitIsDirectory = fs6.statSync(dotGitPath).isDirectory();
  } catch {
  }
  if (dotGitIsDirectory) {
    denyPaths.push(path4.resolve(cwd, ".git/hooks"));
    if (!allowGitConfig) denyPaths.push(path4.resolve(cwd, ".git/config"));
  }
  const iglobArgs = [];
  for (const fileName of DANGEROUS_FILES) iglobArgs.push("--iglob", fileName);
  for (const dirName of dangerousDirectories) iglobArgs.push("--iglob", `**/${dirName}/**`);
  iglobArgs.push("--iglob", "**/.git/hooks/**");
  if (!allowGitConfig) iglobArgs.push("--iglob", "**/.git/config");
  let matches = [];
  try {
    matches = await ripGrep(
      [
        "--files",
        "--hidden",
        "--max-depth",
        String(maxDepth),
        ...iglobArgs,
        "-g",
        "!**/node_modules/**"
      ],
      cwd,
      signal,
      ripgrepConfig
    );
  } catch (error) {
    logForDebugging(`[Sandbox] ripgrep scan failed: ${error}`);
  }
  for (const match of matches) {
    const absolutePath = path4.resolve(cwd, match);
    let foundDir = false;
    for (const dirName of [...dangerousDirectories, ".git"]) {
      const normalizedDirName = normalizeCaseForComparison(dirName);
      const segments = absolutePath.split(path4.sep);
      const dirIndex = segments.findIndex(
        (segment) => normalizeCaseForComparison(segment) === normalizedDirName
      );
      if (dirIndex === -1) continue;
      if (dirName === ".git") {
        const gitDir = segments.slice(0, dirIndex + 1).join(path4.sep);
        if (match.includes(".git/hooks")) denyPaths.push(path4.join(gitDir, "hooks"));
        else if (match.includes(".git/config")) denyPaths.push(path4.join(gitDir, "config"));
      } else {
        denyPaths.push(segments.slice(0, dirIndex + 1).join(path4.sep));
      }
      foundDir = true;
      break;
    }
    if (!foundDir) denyPaths.push(absolutePath);
  }
  return [...new Set(denyPaths)];
}
var directBwrapMountPoints = /* @__PURE__ */ new Set();
var activeDirectSandboxCount = 0;
var exitHandlerRegistered2 = false;
function registerExitCleanupHandler2() {
  if (exitHandlerRegistered2) return;
  process.on("exit", () => cleanupDirectLinuxSandboxMountPoints({ force: true }));
  exitHandlerRegistered2 = true;
}
function cleanupDirectLinuxSandboxMountPoints(opts) {
  if (!opts?.force) {
    if (activeDirectSandboxCount > 0) activeDirectSandboxCount--;
    if (activeDirectSandboxCount > 0) {
      logForDebugging(
        `[Sandbox Linux] Deferring direct mount point cleanup \u2014 ${activeDirectSandboxCount} sandbox(es) still active`
      );
      return;
    }
  } else {
    activeDirectSandboxCount = 0;
  }
  for (const mountPoint of directBwrapMountPoints) {
    try {
      const stat = fs6.statSync(mountPoint);
      if (stat.isFile() && stat.size === 0) {
        fs6.unlinkSync(mountPoint);
        logForDebugging(
          `[Sandbox Linux] Cleaned up direct bwrap mount point (file): ${mountPoint}`
        );
      } else if (stat.isDirectory()) {
        const entries = fs6.readdirSync(mountPoint);
        if (entries.length === 0) {
          fs6.rmdirSync(mountPoint);
          logForDebugging(
            `[Sandbox Linux] Cleaned up direct bwrap mount point (dir): ${mountPoint}`
          );
        }
      }
    } catch {
    }
  }
  directBwrapMountPoints.clear();
}
async function generateFilesystemArgs2(readConfig, writeConfig, ripgrepConfig = { command: "rg" }, mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH2, allowGitConfig = false, abortSignal) {
  const args = [];
  const allowedWritePaths = [];
  const denyWriteArgs = [];
  if (writeConfig) {
    args.push("--ro-bind", "/", "/");
    for (const pathPattern of writeConfig.allowOnly || []) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      logForDebugging(`[Sandbox Linux] Processing write path: ${pathPattern} -> ${normalizedPath}`);
      if (normalizedPath.startsWith("/dev/")) {
        logForDebugging(`[Sandbox Linux] Skipping /dev path: ${normalizedPath}`);
        continue;
      }
      if (!fs6.existsSync(normalizedPath)) {
        logForDebugging(`[Sandbox Linux] Skipping non-existent write path: ${normalizedPath}`);
        continue;
      }
      try {
        const resolvedPath = fs6.realpathSync(normalizedPath);
        const normalizedForComparison = normalizedPath.replace(/\/+$/, "");
        if (resolvedPath !== normalizedForComparison && isSymlinkOutsideBoundary(normalizedPath, resolvedPath)) {
          logForDebugging(
            `[Sandbox Linux] Skipping symlink write path pointing outside expected location: ${pathPattern} -> ${resolvedPath}`
          );
          continue;
        }
      } catch {
        logForDebugging(
          `[Sandbox Linux] Skipping write path that could not be resolved: ${normalizedPath}`
        );
        continue;
      }
      args.push("--bind", normalizedPath, normalizedPath);
      allowedWritePaths.push(normalizedPath);
    }
    const denyPaths = [
      ...writeConfig.denyWithinAllow || [],
      ...await linuxGetMandatoryDenyPaths2(
        ripgrepConfig,
        mandatoryDenySearchDepth,
        allowGitConfig,
        abortSignal
      )
    ];
    const seenDenyWrite = /* @__PURE__ */ new Set();
    for (const pathPattern of denyPaths) {
      const normalizedPath = normalizePathForSandbox(pathPattern);
      if (seenDenyWrite.has(normalizedPath)) continue;
      seenDenyWrite.add(normalizedPath);
      if (normalizedPath.startsWith("/dev/")) continue;
      const symlinkInPath = findSymlinkInPath2(normalizedPath, allowedWritePaths);
      if (symlinkInPath) {
        denyWriteArgs.push("--ro-bind", "/dev/null", symlinkInPath);
        logForDebugging(
          `[Sandbox Linux] Mounted /dev/null at symlink ${symlinkInPath} to prevent symlink replacement attack`
        );
        continue;
      }
      if (!fs6.existsSync(normalizedPath)) {
        if (hasFileAncestor2(normalizedPath)) {
          logForDebugging(
            `[Sandbox Linux] Skipping deny path with file ancestor (cannot create paths under a file): ${normalizedPath}`
          );
          continue;
        }
        let ancestorPath = path4.dirname(normalizedPath);
        while (ancestorPath !== "/" && !fs6.existsSync(ancestorPath)) {
          ancestorPath = path4.dirname(ancestorPath);
        }
        const ancestorIsWithinAllowedPath = allowedWritePaths.some(
          (allowedPath) => ancestorPath.startsWith(allowedPath + "/") || ancestorPath === allowedPath || normalizedPath.startsWith(allowedPath + "/")
        );
        if (ancestorIsWithinAllowedPath) {
          const firstNonExistent = findFirstNonExistentComponent2(normalizedPath);
          if (firstNonExistent !== normalizedPath) {
            const emptyDir = fs6.mkdtempSync(path4.join(tmpdir2(), "claude-empty-"));
            denyWriteArgs.push("--ro-bind", emptyDir, firstNonExistent);
            directBwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler2();
            logForDebugging(
              `[Sandbox Linux] Mounted empty dir at ${firstNonExistent} to block creation of ${normalizedPath}`
            );
          } else {
            denyWriteArgs.push("--ro-bind", "/dev/null", firstNonExistent);
            directBwrapMountPoints.add(firstNonExistent);
            registerExitCleanupHandler2();
            logForDebugging(
              `[Sandbox Linux] Mounted /dev/null at ${firstNonExistent} to block creation of ${normalizedPath}`
            );
          }
        } else {
          logForDebugging(
            `[Sandbox Linux] Skipping non-existent deny path not within allowed paths: ${normalizedPath}`
          );
        }
        continue;
      }
      const isWithinAllowedPath = allowedWritePaths.some(
        (allowedPath) => normalizedPath.startsWith(allowedPath + "/") || normalizedPath === allowedPath
      );
      if (isWithinAllowedPath) denyWriteArgs.push("--ro-bind", normalizedPath, normalizedPath);
      else
        logForDebugging(
          `[Sandbox Linux] Skipping deny path not within allowed paths: ${normalizedPath}`
        );
    }
  } else {
    args.push("--bind", "/", "/");
  }
  const readDenyPaths = [];
  const readAllowPaths = (readConfig?.allowWithinDeny || []).map(
    (pathPattern) => normalizePathForSandbox(pathPattern)
  );
  const maskedFiles = /* @__PURE__ */ new Set();
  const rootSkip = /* @__PURE__ */ new Set(["proc", "dev", "sys"]);
  for (const pathPattern of readConfig?.denyOnly || []) {
    if (normalizePathForSandbox(pathPattern) === "/") {
      for (const child of fs6.readdirSync("/")) {
        if (!rootSkip.has(child)) readDenyPaths.push("/" + child);
      }
    } else {
      readDenyPaths.push(pathPattern);
    }
  }
  if (fs6.existsSync("/etc/ssh/ssh_config.d")) readDenyPaths.push("/etc/ssh/ssh_config.d");
  const normalizedDenyPaths = readDenyPaths.map((pathPattern) => normalizePathForSandbox(pathPattern)).sort((a, b) => a.split("/").length - b.split("/").length);
  for (const normalizedPath of normalizedDenyPaths) {
    if (!fs6.existsSync(normalizedPath)) {
      logForDebugging(`[Sandbox Linux] Skipping non-existent read deny path: ${normalizedPath}`);
      continue;
    }
    const denySep = normalizedPath === "/" ? "/" : normalizedPath + "/";
    const readDenyStat = fs6.statSync(normalizedPath);
    if (readDenyStat.isDirectory()) {
      args.push("--tmpfs", normalizedPath);
      for (const writePath of allowedWritePaths) {
        if (writePath.startsWith(denySep) || writePath === normalizedPath) {
          args.push("--bind", writePath, writePath);
          logForDebugging(
            `[Sandbox Linux] Re-bound write path wiped by denyRead tmpfs: ${writePath}`
          );
        }
      }
      for (const allowPath of readAllowPaths) {
        if (!(allowPath.startsWith(denySep) || allowPath === normalizedPath)) continue;
        if (!fs6.existsSync(allowPath)) {
          logForDebugging(`[Sandbox Linux] Skipping non-existent read allow path: ${allowPath}`);
          continue;
        }
        if (allowedWritePaths.some(
          (writePath) => (writePath.startsWith(denySep) || writePath === normalizedPath) && (allowPath === writePath || allowPath.startsWith(writePath + "/"))
        )) {
          continue;
        }
        args.push("--ro-bind", allowPath, allowPath);
        logForDebugging(
          `[Sandbox Linux] Re-allowed read access within denied region: ${allowPath}`
        );
      }
    } else {
      if (readAllowPaths.includes(normalizedPath)) {
        logForDebugging(
          `[Sandbox Linux] Skipping read deny for re-allowed path: ${normalizedPath}`
        );
        continue;
      }
      args.push("--ro-bind", "/dev/null", normalizedPath);
      maskedFiles.add(normalizedPath);
    }
  }
  for (let i = 0; i < denyWriteArgs.length; i += 3) {
    const dest = denyWriteArgs[i + 2];
    if (maskedFiles.has(dest)) continue;
    args.push(denyWriteArgs[i], denyWriteArgs[i + 1], dest);
  }
  return args;
}
function resolveApplySeccompInvocation(applyPath, argv0) {
  if (argv0) {
    if (!applyPath) throw new Error("seccompConfig.argv0 requires seccompConfig.applyPath");
    return { file: applyPath, argv0 };
  }
  const binary = getApplySeccompBinaryPath(applyPath);
  return binary ? { file: binary } : void 0;
}
function buildNetworkCommandArgs(httpSocketPath, socksSocketPath, command, seccomp, shell) {
  const script = [
    'socat TCP-LISTEN:3128,fork,reuseaddr "UNIX-CONNECT:$1" >/dev/null 2>&1 &',
    "http_pid=$!",
    'socat TCP-LISTEN:1080,fork,reuseaddr "UNIX-CONNECT:$2" >/dev/null 2>&1 &',
    "socks_pid=$!",
    'cleanup() { kill "$http_pid" "$socks_pid" 2>/dev/null; }',
    "trap cleanup EXIT",
    'if [ -n "$4" ]; then',
    '  if [ -n "$5" ]; then',
    '    ARGV0="$5" "$4" "$3" -c "$6"',
    "  else",
    '    "$4" "$3" -c "$6"',
    "  fi",
    "else",
    '  "$3" -c "$6"',
    "fi",
    "status=$?",
    "exit $status"
  ].join("\n");
  return [
    shell,
    "-c",
    script,
    "pi-sandbox-network",
    httpSocketPath,
    socksSocketPath,
    shell,
    seccomp?.file ?? "",
    seccomp?.argv0 ?? "",
    command
  ];
}
async function createDirectLinuxSandboxCommand(params) {
  const {
    command,
    needsNetworkRestriction,
    httpSocketPath,
    socksSocketPath,
    httpProxyPort,
    socksProxyPort,
    readConfig,
    writeConfig,
    enableWeakerNestedSandbox,
    allowAllUnixSockets,
    shell,
    ripgrepConfig = { command: "rg" },
    mandatoryDenySearchDepth = DEFAULT_MANDATORY_DENY_SEARCH_DEPTH2,
    allowGitConfig = false,
    seccompConfig,
    abortSignal
  } = params;
  const hasReadRestrictions = readConfig && readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = writeConfig !== void 0;
  if (!needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return { file: shell, args: ["-c", command] };
  }
  activeDirectSandboxCount++;
  const bwrapArgs = ["--new-session", "--die-with-parent"];
  let seccomp;
  try {
    if (!allowAllUnixSockets) {
      seccomp = resolveApplySeccompInvocation(seccompConfig?.applyPath, seccompConfig?.argv0);
      if (!seccomp) {
        logForDebugging(
          "[Sandbox Linux] apply-seccomp binary not available - unix socket blocking disabled. Install @anthropic-ai/sandbox-runtime globally for full protection.",
          { level: "warn" }
        );
      } else {
        logForDebugging("[Sandbox Linux] Applying seccomp filter for Unix socket blocking");
      }
    } else {
      logForDebugging("[Sandbox Linux] Skipping seccomp filter - allowAllUnixSockets is enabled");
    }
    if (needsNetworkRestriction) {
      bwrapArgs.push("--unshare-net");
      if (httpSocketPath && socksSocketPath) {
        if (!fs6.existsSync(httpSocketPath)) {
          throw new Error(
            `Linux HTTP bridge socket does not exist: ${httpSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`
          );
        }
        if (!fs6.existsSync(socksSocketPath)) {
          throw new Error(
            `Linux SOCKS bridge socket does not exist: ${socksSocketPath}. The bridge process may have died. Try reinitializing the sandbox.`
          );
        }
        bwrapArgs.push("--bind", httpSocketPath, httpSocketPath);
        bwrapArgs.push("--bind", socksSocketPath, socksSocketPath);
        const proxyEnv = generateSandboxProxyEnvVars(3128, 1080);
        bwrapArgs.push(
          ...proxyEnv.flatMap((env) => {
            const firstEq = env.indexOf("=");
            const key = env.slice(0, firstEq);
            const value = env.slice(firstEq + 1);
            return ["--setenv", key, value];
          })
        );
        if (httpProxyPort !== void 0) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_HTTP_PROXY_PORT", String(httpProxyPort));
        }
        if (socksProxyPort !== void 0) {
          bwrapArgs.push("--setenv", "CLAUDE_CODE_HOST_SOCKS_PROXY_PORT", String(socksProxyPort));
        }
      }
    }
    bwrapArgs.push(
      ...await generateFilesystemArgs2(
        readConfig,
        writeConfig,
        ripgrepConfig,
        mandatoryDenySearchDepth,
        allowGitConfig,
        abortSignal
      )
    );
    bwrapArgs.push("--dev", "/dev");
    bwrapArgs.push("--unshare-pid");
    if (!enableWeakerNestedSandbox) {
      bwrapArgs.push("--proc", "/proc");
    } else {
      bwrapArgs.push("--unshare-user", "--bind", "/proc", "/proc");
    }
    const resolvedShell = whichSync(shell);
    if (!resolvedShell) throw new Error(`Shell '${shell}' not found in PATH`);
    if (needsNetworkRestriction && httpSocketPath && socksSocketPath) {
      bwrapArgs.push(
        "--",
        ...buildNetworkCommandArgs(
          httpSocketPath,
          socksSocketPath,
          command,
          seccomp,
          resolvedShell
        )
      );
    } else if (seccomp) {
      if (seccomp.argv0) bwrapArgs.push("--setenv", "ARGV0", seccomp.argv0);
      bwrapArgs.push("--", seccomp.file, resolvedShell, "-c", command);
    } else {
      bwrapArgs.push("--", resolvedShell, "-c", command);
    }
    const restrictions = [];
    if (needsNetworkRestriction) restrictions.push("network");
    if (hasReadRestrictions || hasWriteRestrictions) restrictions.push("filesystem");
    if (seccomp) restrictions.push("seccomp(unix-block)");
    logForDebugging(
      `[Sandbox Linux] Wrapped command with direct bwrap argv (${restrictions.join(", ")} restrictions)`
    );
    return { file: "bwrap", args: bwrapArgs, cleanup: cleanupDirectLinuxSandboxMountPoints };
  } catch (error) {
    if (activeDirectSandboxCount > 0) activeDirectSandboxCount--;
    throw error;
  }
}

// src/direct-macos-sandbox.ts
import { spawn as spawn4 } from "node:child_process";
import { realpathSync as realpathSync4 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import * as path5 from "node:path";
var directSessionSuffix = `_${Math.random().toString(36).slice(2, 11)}_PI_SBX`;
function generateLogTag2(command) {
  return `CMD64_${encodeSandboxedCommand(command)}_END_${directSessionSuffix}`;
}
function macGetMandatoryDenyPatterns2(allowGitConfig = false) {
  const cwd = process.cwd();
  const denyPaths = [];
  for (const fileName of DANGEROUS_FILES) {
    denyPaths.push(path5.resolve(cwd, fileName));
    denyPaths.push(`**/${fileName}`);
  }
  for (const dirName of getDangerousDirectories()) {
    denyPaths.push(path5.resolve(cwd, dirName));
    denyPaths.push(`**/${dirName}/**`);
  }
  denyPaths.push(path5.resolve(cwd, ".git/hooks"));
  denyPaths.push("**/.git/hooks/**");
  if (!allowGitConfig) {
    denyPaths.push(path5.resolve(cwd, ".git/config"));
    denyPaths.push("**/.git/config");
  }
  return [...new Set(denyPaths)];
}
function normalizeSandboxPath(pathPattern) {
  let normalizedPath = pathPattern;
  if (pathPattern === "~") {
    normalizedPath = homedir3();
  } else if (pathPattern.startsWith("~/")) {
    normalizedPath = homedir3() + pathPattern.slice(1);
  } else if (pathPattern.startsWith("./") || pathPattern.startsWith("../")) {
    normalizedPath = path5.resolve(process.cwd(), pathPattern);
  } else if (!path5.isAbsolute(pathPattern)) {
    normalizedPath = path5.resolve(process.cwd(), pathPattern);
  }
  if (containsGlobChars(normalizedPath)) {
    const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
    if (!staticPrefix || staticPrefix === "/") return normalizedPath;
    const baseDir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : path5.dirname(staticPrefix);
    try {
      const resolvedBaseDir = realpathSync4(baseDir);
      return resolvedBaseDir + normalizedPath.slice(baseDir.length);
    } catch {
      return normalizedPath;
    }
  }
  try {
    return realpathSync4(normalizedPath);
  } catch {
    return normalizedPath;
  }
}
function getAncestorDirectoriesWithinCwd(pathStr) {
  const cwd = normalizeSandboxPath(process.cwd());
  const ancestors = [];
  let currentPath = path5.dirname(pathStr);
  while (currentPath !== "/" && currentPath !== ".") {
    if (currentPath === cwd || currentPath.startsWith(cwd + "/")) {
      ancestors.push(currentPath);
    }
    const parentPath = path5.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  return ancestors;
}
function escapePath2(pathStr) {
  return JSON.stringify(pathStr);
}
function generateMoveBlockingRules2(pathPatterns, logTag) {
  const rules = [];
  const ops = ["file-write-unlink", "file-write-create"];
  for (const pathPattern of pathPatterns) {
    const normalizedPath = normalizeSandboxPath(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      for (const op of ops) {
        rules.push(
          `(deny ${op}`,
          `  (regex ${escapePath2(regexPattern)})`,
          `  (with message "${logTag}"))`
        );
      }
      const staticPrefix = normalizedPath.split(/[*?[\]]/)[0];
      if (staticPrefix && staticPrefix !== "/") {
        const baseDir = staticPrefix.endsWith("/") ? staticPrefix.slice(0, -1) : path5.dirname(staticPrefix);
        for (const op of ops) {
          rules.push(
            `(deny ${op}`,
            `  (literal ${escapePath2(baseDir)})`,
            `  (with message "${logTag}"))`
          );
        }
        for (const ancestorDir of getAncestorDirectoriesWithinCwd(baseDir)) {
          for (const op of ops) {
            rules.push(
              `(deny ${op}`,
              `  (literal ${escapePath2(ancestorDir)})`,
              `  (with message "${logTag}"))`
            );
          }
        }
      }
    } else {
      for (const op of ops) {
        rules.push(
          `(deny ${op}`,
          `  (subpath ${escapePath2(normalizedPath)})`,
          `  (with message "${logTag}"))`
        );
      }
      for (const ancestorDir of getAncestorDirectoriesWithinCwd(normalizedPath)) {
        for (const op of ops) {
          rules.push(
            `(deny ${op}`,
            `  (literal ${escapePath2(ancestorDir)})`,
            `  (with message "${logTag}"))`
          );
        }
      }
    }
  }
  return rules;
}
function generateReadRules2(config2, logTag, writeAllowPaths) {
  if (!config2) return ["(allow file-read*)"];
  const rules = [];
  let deniesRoot = false;
  rules.push("(allow file-read*)");
  for (const pathPattern of config2.denyOnly || []) {
    const normalizedPath = normalizeSandboxPath(pathPattern);
    if (normalizedPath === "/") deniesRoot = true;
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(deny file-read*",
        `  (regex ${escapePath2(regexPattern)})`,
        `  (with message "${logTag}"))`
      );
    } else {
      rules.push(
        "(deny file-read*",
        `  (subpath ${escapePath2(normalizedPath)})`,
        `  (with message "${logTag}"))`
      );
    }
  }
  if (deniesRoot) rules.push('(allow file-read* (literal "/"))');
  for (const pathPattern of config2.allowWithinDeny || []) {
    const normalizedPath = normalizeSandboxPath(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(allow file-read*",
        `  (regex ${escapePath2(regexPattern)})`,
        `  (with message "${logTag}"))`
      );
    } else {
      rules.push(
        "(allow file-read*",
        `  (subpath ${escapePath2(normalizedPath)})`,
        `  (with message "${logTag}"))`
      );
    }
  }
  if (config2.denyOnly.length > 0) {
    rules.push("(allow file-read-metadata", "  (vnode-type DIRECTORY))");
  }
  rules.push(...generateMoveBlockingRules2(config2.denyOnly || [], logTag));
  if (writeAllowPaths && writeAllowPaths.length > 0) {
    for (const pathPattern of writeAllowPaths) {
      const normalizedPath = normalizeSandboxPath(pathPattern);
      for (const op of ["file-write-unlink", "file-write-create"]) {
        if (containsGlobChars(normalizedPath)) {
          const regexPattern = globToRegex(normalizedPath);
          rules.push(
            `(allow ${op}`,
            `  (regex ${escapePath2(regexPattern)})`,
            `  (with message "${logTag}"))`
          );
        } else {
          rules.push(
            `(allow ${op}`,
            `  (subpath ${escapePath2(normalizedPath)})`,
            `  (with message "${logTag}"))`
          );
        }
      }
    }
  }
  return rules;
}
function generateWriteRules2(config2, logTag, allowGitConfig = false) {
  if (!config2) return ["(allow file-write*)"];
  const rules = [];
  for (const pathPattern of config2.allowOnly || []) {
    const normalizedPath = normalizeSandboxPath(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(allow file-write*",
        `  (regex ${escapePath2(regexPattern)})`,
        `  (with message "${logTag}"))`
      );
    } else {
      rules.push(
        "(allow file-write*",
        `  (subpath ${escapePath2(normalizedPath)})`,
        `  (with message "${logTag}"))`
      );
    }
  }
  const denyPaths = [
    ...config2.denyWithinAllow || [],
    ...macGetMandatoryDenyPatterns2(allowGitConfig)
  ];
  for (const pathPattern of denyPaths) {
    const normalizedPath = normalizeSandboxPath(pathPattern);
    if (containsGlobChars(normalizedPath)) {
      const regexPattern = globToRegex(normalizedPath);
      rules.push(
        "(deny file-write*",
        `  (regex ${escapePath2(regexPattern)})`,
        `  (with message "${logTag}"))`
      );
    } else {
      rules.push(
        "(deny file-write*",
        `  (subpath ${escapePath2(normalizedPath)})`,
        `  (with message "${logTag}"))`
      );
    }
  }
  rules.push(...generateMoveBlockingRules2(denyPaths, logTag));
  return rules;
}
function generateSandboxProfile2({
  readConfig,
  writeConfig,
  httpProxyPort,
  socksProxyPort,
  needsNetworkRestriction,
  allowUnixSockets,
  allowAllUnixSockets,
  allowLocalBinding,
  allowMachLookup,
  allowPty,
  allowBrowserProcess = false,
  allowGitConfig = false,
  enableWeakerNetworkIsolation = false,
  logTag
}) {
  const profile = [
    "(version 1)",
    `(deny default (with message "${logTag}"))`,
    "",
    `; LogTag: ${logTag}`,
    "",
    "; Essential permissions - based on Chrome sandbox policy",
    "; Process permissions",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow mach-priv-task-port (target same-sandbox))",
    "",
    "; User preferences",
    "(allow user-preference-read)",
    "",
    "; Mach IPC - specific services only (no wildcard)",
    "(allow mach-lookup",
    '  (global-name "com.apple.audio.systemsoundserver")',
    '  (global-name "com.apple.distributed_notifications@Uv3")',
    '  (global-name "com.apple.FontObjectsServer")',
    '  (global-name "com.apple.fonts")',
    '  (global-name "com.apple.logd")',
    '  (global-name "com.apple.lsd.mapdb")',
    '  (global-name "com.apple.PowerManagement.control")',
    '  (global-name "com.apple.system.logger")',
    '  (global-name "com.apple.system.notification_center")',
    '  (global-name "com.apple.system.opendirectoryd.libinfo")',
    '  (global-name "com.apple.system.opendirectoryd.membership")',
    '  (global-name "com.apple.bsd.dirhelper")',
    '  (global-name "com.apple.securityd.xpc")',
    '  (global-name "com.apple.coreservices.launchservicesd")',
    ")",
    "",
    ...enableWeakerNetworkIsolation ? [
      "; trustd.agent - needed for Go TLS certificate verification (weaker network isolation)",
      '(allow mach-lookup (global-name "com.apple.trustd.agent"))',
      "; configd - needed for Rust/Go programs that query system proxy/network config (uv, cargo)",
      '(allow mach-lookup (global-name "com.apple.SystemConfiguration.configd"))'
    ] : [],
    ...allowMachLookup && allowMachLookup.length > 0 ? [
      "; User-specified XPC/Mach services",
      ...allowMachLookup.map(
        (name) => name.endsWith("*") ? `(allow mach-lookup (global-name-prefix ${escapePath2(name.slice(0, -1))}))` : `(allow mach-lookup (global-name ${escapePath2(name)}))`
      )
    ] : [],
    "",
    "; POSIX IPC - shared memory",
    "(allow ipc-posix-shm)",
    "",
    "; POSIX IPC - semaphores for Python multiprocessing",
    "(allow ipc-posix-sem)",
    "",
    "; IOKit - specific operations only",
    "(allow iokit-open",
    '  (iokit-registry-entry-class "IOSurfaceRootUserClient")',
    '  (iokit-registry-entry-class "RootDomainUserClient")',
    '  (iokit-user-client-class "IOSurfaceSendRight")',
    ")",
    "",
    "; IOKit properties",
    "(allow iokit-get-properties)",
    "",
    "; Specific safe system-sockets, doesn't allow network access",
    "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))",
    "",
    "; sysctl - specific sysctls only",
    "(allow sysctl-read",
    '  (sysctl-name "hw.activecpu")',
    '  (sysctl-name "hw.busfrequency_compat")',
    '  (sysctl-name "hw.byteorder")',
    '  (sysctl-name "hw.cacheconfig")',
    '  (sysctl-name "hw.cachelinesize_compat")',
    '  (sysctl-name "hw.cpufamily")',
    '  (sysctl-name "hw.cpufrequency")',
    '  (sysctl-name "hw.cpufrequency_compat")',
    '  (sysctl-name "hw.cputype")',
    '  (sysctl-name "hw.l1dcachesize_compat")',
    '  (sysctl-name "hw.l1icachesize_compat")',
    '  (sysctl-name "hw.l2cachesize_compat")',
    '  (sysctl-name "hw.l3cachesize_compat")',
    '  (sysctl-name "hw.logicalcpu")',
    '  (sysctl-name "hw.logicalcpu_max")',
    '  (sysctl-name "hw.machine")',
    '  (sysctl-name "hw.memsize")',
    '  (sysctl-name "hw.ncpu")',
    '  (sysctl-name "hw.nperflevels")',
    '  (sysctl-name "hw.packages")',
    '  (sysctl-name "hw.pagesize_compat")',
    '  (sysctl-name "hw.pagesize")',
    '  (sysctl-name "hw.physicalcpu")',
    '  (sysctl-name "hw.physicalcpu_max")',
    '  (sysctl-name "hw.tbfrequency_compat")',
    '  (sysctl-name "hw.vectorunit")',
    '  (sysctl-name "kern.argmax")',
    '  (sysctl-name "kern.bootargs")',
    '  (sysctl-name "kern.hostname")',
    '  (sysctl-name "kern.maxfiles")',
    '  (sysctl-name "kern.maxfilesperproc")',
    '  (sysctl-name "kern.maxproc")',
    '  (sysctl-name "kern.ngroups")',
    '  (sysctl-name "kern.osproductversion")',
    '  (sysctl-name "kern.osrelease")',
    '  (sysctl-name "kern.ostype")',
    '  (sysctl-name "kern.osvariant_status")',
    '  (sysctl-name "kern.osversion")',
    '  (sysctl-name "kern.secure_kernel")',
    '  (sysctl-name "kern.tcsm_available")',
    '  (sysctl-name "kern.tcsm_enable")',
    '  (sysctl-name "kern.usrstack64")',
    '  (sysctl-name "kern.version")',
    '  (sysctl-name "kern.willshutdown")',
    '  (sysctl-name "machdep.cpu.brand_string")',
    '  (sysctl-name "machdep.ptrauth_enabled")',
    '  (sysctl-name "security.mac.lockdown_mode_state")',
    '  (sysctl-name "sysctl.proc_cputype")',
    '  (sysctl-name "vm.loadavg")',
    '  (sysctl-name-prefix "hw.optional.arm")',
    '  (sysctl-name-prefix "hw.optional.arm.")',
    '  (sysctl-name-prefix "hw.optional.armv8_")',
    '  (sysctl-name-prefix "hw.perflevel")',
    '  (sysctl-name-prefix "kern.proc.all")',
    '  (sysctl-name-prefix "kern.proc.pgrp.")',
    '  (sysctl-name-prefix "kern.proc.pid.")',
    '  (sysctl-name-prefix "machdep.cpu.")',
    '  (sysctl-name-prefix "net.routetable.")',
    ")",
    "",
    "; V8 thread calculations",
    "(allow sysctl-write",
    '  (sysctl-name "kern.tcsm_enable")',
    ")",
    "",
    "; Distributed notifications",
    "(allow distributed-notification-post)",
    "",
    "; Specific mach-lookup permissions for security operations",
    '(allow mach-lookup (global-name "com.apple.SecurityServer"))',
    "",
    "; File I/O on device files",
    '(allow file-ioctl (literal "/dev/null"))',
    '(allow file-ioctl (literal "/dev/zero"))',
    '(allow file-ioctl (literal "/dev/random"))',
    '(allow file-ioctl (literal "/dev/urandom"))',
    '(allow file-ioctl (literal "/dev/dtracehelper"))',
    '(allow file-ioctl (literal "/dev/tty"))',
    "",
    "(allow file-ioctl file-read-data file-write-data",
    "  (require-all",
    '    (literal "/dev/null")',
    "    (vnode-type CHARACTER-DEVICE)",
    "  )",
    ")",
    ""
  ];
  profile.push("; Network");
  if (!needsNetworkRestriction) {
    profile.push("(allow network*)");
  } else {
    if (allowLocalBinding) {
      profile.push('(allow network-bind (local ip "*:*"))');
      profile.push('(allow network-inbound (local ip "*:*"))');
      profile.push('(allow network-outbound (local ip "*:*"))');
    }
    if (allowAllUnixSockets) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      profile.push('(allow network-bind (local unix-socket (path-regex #"^/")))');
      profile.push('(allow network-outbound (remote unix-socket (path-regex #"^/")))');
    } else if (allowUnixSockets && allowUnixSockets.length > 0) {
      profile.push("(allow system-socket (socket-domain AF_UNIX))");
      for (const socketPath of allowUnixSockets) {
        const normalizedPath = normalizeSandboxPath(socketPath);
        profile.push(
          `(allow network-bind (local unix-socket (subpath ${escapePath2(normalizedPath)})))`
        );
        profile.push(
          `(allow network-outbound (remote unix-socket (subpath ${escapePath2(normalizedPath)})))`
        );
      }
    }
    if (httpProxyPort !== void 0) {
      profile.push(`(allow network-bind (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${httpProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${httpProxyPort}"))`);
    }
    if (socksProxyPort !== void 0) {
      profile.push(`(allow network-bind (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-inbound (local ip "localhost:${socksProxyPort}"))`);
      profile.push(`(allow network-outbound (remote ip "localhost:${socksProxyPort}"))`);
    }
  }
  profile.push("");
  profile.push("; File read");
  profile.push(...generateReadRules2(readConfig, logTag, writeConfig?.allowOnly));
  profile.push("");
  profile.push("; File write");
  profile.push(...generateWriteRules2(writeConfig, logTag, allowGitConfig));
  if (allowPty) {
    profile.push(
      "",
      "; Pseudo-terminal (pty) support",
      "(allow pseudo-tty)",
      "(allow file-ioctl",
      '  (literal "/dev/ptmx")',
      '  (regex #"^/dev/ttys")',
      ")",
      "(allow file-read* file-write*",
      '  (literal "/dev/ptmx")',
      '  (regex #"^/dev/ttys")',
      ")"
    );
  }
  if (allowBrowserProcess) {
    profile.push(
      "",
      "; Browser process support (Chrome/Chromium)",
      "; All Mach operations \u2014 Chrome requires bootstrap registration",
      "; (Crashpad), service lookups (window server, CoreDisplay, GPU),",
      "; task ports, and cross-domain lookups that vary by OS version",
      "(allow mach*)",
      "",
      "; Process info for all processes \u2014 Chrome manages renderer, GPU,",
      "; utility, and crashpad child processes outside the same sandbox",
      "(allow process-info*)",
      "",
      "; Broader IOKit access \u2014 needed for GPU process and display management",
      "(allow iokit-open)",
      "",
      "; Shared memory with non-sandboxed processes (e.g. renderer \u2194 GPU)",
      "(allow ipc-posix-shm*)"
    );
  }
  return profile.join("\n");
}
function createDirectMacSandboxCommand(params) {
  const hasReadRestrictions = params.readConfig && params.readConfig.denyOnly.length > 0;
  const hasWriteRestrictions = params.writeConfig !== void 0;
  if (!params.needsNetworkRestriction && !hasReadRestrictions && !hasWriteRestrictions) {
    return { file: params.shell, args: ["-c", params.command] };
  }
  const profile = generateSandboxProfile2({ ...params, logTag: generateLogTag2(params.command) });
  return {
    file: "env",
    args: [
      ...generateSandboxProxyEnvVars(params.httpProxyPort, params.socksProxyPort),
      "sandbox-exec",
      "-p",
      profile,
      params.shell,
      "-c",
      params.command
    ]
  };
}
function startDirectMacSandboxLogMonitor(callback, ignoreViolations) {
  const cmdExtractRegex = /CMD64_(.+?)_END/;
  const sandboxExtractRegex = /Sandbox:\s+(.+)$/;
  const wildcardPaths = ignoreViolations?.["*"] || [];
  const commandPatterns = ignoreViolations ? Object.entries(ignoreViolations).filter(([pattern]) => pattern !== "*") : [];
  const logProcess = spawn4("log", [
    "stream",
    "--predicate",
    `(eventMessage ENDSWITH "${directSessionSuffix}")`,
    "--style",
    "compact"
  ]);
  logProcess.stdout?.on("data", (data) => {
    const lines = data.toString().split("\n");
    const violationLines = lines.filter(
      (line) => line.includes("Sandbox:") && line.includes("deny")
    );
    const commandLine = lines.find((line) => line.startsWith("CMD64_"));
    if (violationLines.length === 0) return;
    let command;
    let encodedCommand;
    if (commandLine) {
      const cmdMatch = commandLine.match(cmdExtractRegex);
      encodedCommand = cmdMatch?.[1];
      if (encodedCommand) {
        try {
          command = decodeSandboxedCommand(encodedCommand);
        } catch {
        }
      }
    }
    for (const violationLine of violationLines) {
      const sandboxMatch = violationLine.match(sandboxExtractRegex);
      if (!sandboxMatch?.[1]) continue;
      const violationDetails = sandboxMatch[1];
      if (violationDetails.includes("mDNSResponder") || violationDetails.includes("mach-lookup com.apple.diagnosticd") || violationDetails.includes("mach-lookup com.apple.analyticsd")) {
        continue;
      }
      if (ignoreViolations && command) {
        if (wildcardPaths.some((ignoredPath) => violationDetails.includes(ignoredPath))) continue;
        let ignoredByCommandPattern = false;
        for (const [pattern, paths] of commandPatterns) {
          if (command.includes(pattern) && paths.some((ignoredPath) => violationDetails.includes(ignoredPath))) {
            ignoredByCommandPattern = true;
            break;
          }
        }
        if (ignoredByCommandPattern) continue;
      }
      callback({ line: violationDetails, command, encodedCommand, timestamp: /* @__PURE__ */ new Date() });
    }
  });
  logProcess.stderr?.on("data", () => {
  });
  return () => logProcess.kill("SIGTERM");
}

// src/sandbox-violation-parser.ts
function parseSandboxPaths(pathText) {
  const matches = pathText.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\S+/g) ?? [];
  return matches.map((match) => {
    const trimmed = match.trim();
    if (trimmed.startsWith('"') && trimmed.endsWith('"') || trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }).filter((match) => match.startsWith("/"));
}
function parseSandboxFilesystemViolationLine(line) {
  const directMatch = line.match(/\bdeny(?:\(\d+\))?\s+(file-(read|write)[^\s]*)\s+(.+)$/);
  if (directMatch) {
    const [path6] = parseSandboxPaths(directMatch[3]);
    if (!path6) return null;
    return { path: path6, access: directMatch[2] };
  }
  const forbiddenLinkMatch = line.match(
    /\bdeny(?:\(\d+\))?\s+forbidden-link-priv<(file-(read|write)[^>]*)>\s+(.+)$/
  );
  if (!forbiddenLinkMatch) return null;
  const [sourcePath] = parseSandboxPaths(forbiddenLinkMatch[3]);
  if (!sourcePath) return null;
  return {
    path: sourcePath,
    access: forbiddenLinkMatch[2]
  };
}

// src/index.ts
var DEFAULT_CONFIG = {
  enabled: true,
  network: {
    allowedDomains: [
      "npmjs.org",
      "*.npmjs.org",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "*.pypi.org",
      "github.com",
      "*.github.com",
      "api.github.com",
      "raw.githubusercontent.com"
    ],
    deniedDomains: []
  },
  filesystem: {
    denyRead: ["/Users", "/home"],
    allowRead: [".", "~/.config", "~/.local", "Library"],
    allowWrite: [".", "/tmp"],
    denyWrite: [".env", ".env.*", "*.pem", "*.key"]
  }
};
var READ_ONLY_LOCK_DENY_WRITE_PATHS = [
  "/tmp/claude",
  "/private/tmp/claude",
  join4(homedir4(), ".npm", "_logs"),
  join4(homedir4(), ".claude", "debug")
];
var PROCESS_READ_ONLY_LOCK_ALLOW_WRITE_PATHS = [join4(homedir4(), ".pi", "agent")];
var FS_WRITE_PATCH_STATE_KEY = /* @__PURE__ */ Symbol.for("pi-sandbox.fs-write-patch-state");
var fsWritePatchState = globalThis[FS_WRITE_PATCH_STATE_KEY] ??= { patched: false, bypassDepth: 0 };
function describeFsTarget(target) {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.toString();
  if (Buffer.isBuffer(target)) return target.toString("utf8");
  return void 0;
}
function getFsTargetPath(target) {
  if (typeof target === "string") return resolve4(target.replace(/^~(?=$|\/)/, homedir4()));
  if (target instanceof URL && target.protocol === "file:") return resolve4(fileURLToPath2(target));
  if (Buffer.isBuffer(target)) return resolve4(target.toString("utf8"));
  return void 0;
}
function isProcessWriteAllowedByPath(target) {
  const targetPath = getFsTargetPath(target);
  if (!targetPath) return false;
  return PROCESS_READ_ONLY_LOCK_ALLOW_WRITE_PATHS.some((allowedPath) => {
    const resolvedAllowedPath = resolve4(allowedPath);
    return targetPath === resolvedAllowedPath || targetPath.startsWith(resolvedAllowedPath + "/");
  });
}
function createReadOnlyWriteError(operation, target) {
  const targetText = describeFsTarget(target);
  const error = new Error(
    `Sandbox read-only lock: ${operation} denied${targetText ? ` for "${targetText}"` : ""}`
  );
  error.code = "ERR_PI_SANDBOX_READ_ONLY";
  return error;
}
function assertProcessWriteAllowed(operation, target) {
  if (fsWritePatchState.bypassDepth === 0 && fsWritePatchState.deniesWrite?.(target)) {
    throw createReadOnlyWriteError(operation, target);
  }
}
function runWithWriteLockBypass(fn) {
  fsWritePatchState.bypassDepth++;
  try {
    const result = fn();
    if (result && typeof result.finally === "function") {
      return result.finally(() => {
        fsWritePatchState.bypassDepth--;
      });
    }
    fsWritePatchState.bypassDepth--;
    return result;
  } catch (error) {
    fsWritePatchState.bypassDepth--;
    throw error;
  }
}
function isWriteFlag(flags) {
  if (typeof flags === "number") {
    return Boolean(
      flags & (fs7.constants.O_WRONLY | fs7.constants.O_RDWR | fs7.constants.O_APPEND | fs7.constants.O_CREAT | fs7.constants.O_TRUNC)
    );
  }
  if (typeof flags !== "string") return false;
  return flags.includes("+") || flags.startsWith("w") || flags.startsWith("a");
}
function patchMethod(target, method, wrap) {
  const original = target[method];
  if (typeof original !== "function") return;
  target[method] = wrap(original);
}
function patchPathMutation(target, method, targetArgIndex = 0) {
  patchMethod(
    target,
    method,
    (original) => function patchedPathMutation(...args) {
      assertProcessWriteAllowed(method, args[targetArgIndex]);
      return original.apply(this, args);
    }
  );
}
function patchOpenMutation(target, method) {
  patchMethod(
    target,
    method,
    (original) => function patchedOpen(...args) {
      if (isWriteFlag(args[1])) assertProcessWriteAllowed(method, args[0]);
      return original.apply(this, args);
    }
  );
}
function patchCreateWriteStream(target) {
  patchMethod(
    target,
    "createWriteStream",
    (original) => function patchedCreateWriteStream(...args) {
      assertProcessWriteAllowed("createWriteStream", args[0]);
      return original.apply(this, args);
    }
  );
}
function patchFsWriteApis(deniesWrite) {
  fsWritePatchState.deniesWrite = deniesWrite;
  if (fsWritePatchState.patched) return;
  const fsModule = fs7;
  const fsPromisesModule = fsPromises;
  const pathMutations = [
    ["writeFile"],
    ["appendFile"],
    ["mkdir"],
    ["mkdtemp"],
    ["mkdtempDisposable"],
    ["rm"],
    ["unlink"],
    ["rmdir"],
    ["rename", 1],
    ["copyFile", 1],
    ["cp", 1],
    ["truncate"],
    ["chmod"],
    ["chown"],
    ["lchmod"],
    ["lchown"],
    ["utimes"],
    ["lutimes"],
    ["symlink", 1],
    ["link", 1]
  ];
  for (const [method, targetArgIndex] of pathMutations) {
    patchPathMutation(fsModule, method, targetArgIndex);
    patchPathMutation(fsModule, `${method}Sync`, targetArgIndex);
    patchPathMutation(fsPromisesModule, method, targetArgIndex);
  }
  patchOpenMutation(fsModule, "open");
  patchOpenMutation(fsModule, "openSync");
  patchOpenMutation(fsPromisesModule, "open");
  patchCreateWriteStream(fsModule);
  syncBuiltinESMExports();
  fsWritePatchState.patched = true;
}
function loadConfig(cwd) {
  const projectConfigPath = join4(cwd, ".pi", "sandbox.json");
  const globalConfigPath = join4(getAgentDir(), "sandbox.json");
  let globalConfig = {};
  let projectConfig = {};
  if (existsSync5(globalConfigPath)) {
    try {
      globalConfig = JSON.parse(readFileSync2(globalConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${globalConfigPath}: ${e}`);
    }
  }
  if (existsSync5(projectConfigPath)) {
    try {
      projectConfig = JSON.parse(readFileSync2(projectConfigPath, "utf-8"));
    } catch (e) {
      console.error(`Warning: Could not parse ${projectConfigPath}: ${e}`);
    }
  }
  return deepMerge(deepMerge(DEFAULT_CONFIG, globalConfig), projectConfig);
}
function deepMerge(base, overrides) {
  const result = { ...base };
  if (overrides.enabled !== void 0) result.enabled = overrides.enabled;
  if (overrides.network) {
    result.network = { ...base.network, ...overrides.network };
  }
  if (overrides.filesystem) {
    result.filesystem = { ...base.filesystem, ...overrides.filesystem };
    if (overrides.filesystem.denyRead !== void 0 && overrides.filesystem.allowRead === void 0) {
      result.filesystem.allowRead = [];
    }
  }
  const extOverrides = overrides;
  const extResult = result;
  if (extOverrides.ignoreViolations) {
    extResult.ignoreViolations = extOverrides.ignoreViolations;
  }
  if (extOverrides.enableWeakerNestedSandbox !== void 0) {
    extResult.enableWeakerNestedSandbox = extOverrides.enableWeakerNestedSandbox;
  }
  if (extOverrides.allowBrowserProcess !== void 0) {
    extResult.allowBrowserProcess = extOverrides.allowBrowserProcess;
  }
  return result;
}
function shouldPromptForWrite(path6, allowWrite, matchesPattern2) {
  return allowWrite.length === 0 || !matchesPattern2(path6, allowWrite);
}
function getReadBlockReason(path6, denyRead, allowRead, sessionAllowRead, matchesPattern2) {
  if (matchesPattern2(path6, sessionAllowRead)) return null;
  if (allowRead.length > 0) {
    return matchesPattern2(path6, allowRead) ? null : "allowRead";
  }
  return matchesPattern2(path6, denyRead) ? "denyRead" : null;
}
function normalizeNetworkHost(host) {
  const trimmed = host.trim().toLowerCase().replace(/\.$/, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
function extractDomainsFromCommand(command) {
  const urlRegex = /https?:\/\/[^\s'"<>]+/gi;
  const domains = /* @__PURE__ */ new Set();
  let match;
  while ((match = urlRegex.exec(command)) !== null) {
    try {
      domains.add(normalizeNetworkHost(new URL(match[0]).hostname));
    } catch {
    }
  }
  return [...domains];
}
function cidrMatchesHost(host, cidr) {
  const slashIndex = cidr.indexOf("/");
  if (slashIndex === -1) return false;
  const baseAddress = normalizeNetworkHost(cidr.slice(0, slashIndex));
  const prefixLength = Number(cidr.slice(slashIndex + 1));
  const family = isIP3(baseAddress);
  const hostFamily = isIP3(host);
  if (!family || family !== hostFamily || !Number.isInteger(prefixLength)) return false;
  if (prefixLength < 0 || prefixLength > (family === 4 ? 32 : 128)) return false;
  try {
    const blockList = new BlockList2();
    const familyName = family === 4 ? "ipv4" : "ipv6";
    blockList.addSubnet(baseAddress, prefixLength, familyName);
    return blockList.check(host, familyName);
  } catch {
    return false;
  }
}
function domainMatchesPattern(domain, pattern) {
  const host = normalizeNetworkHost(domain);
  const normalizedPattern = normalizeNetworkHost(pattern);
  if (normalizedPattern === "*") return true;
  if (normalizedPattern.includes("/")) return cidrMatchesHost(host, normalizedPattern);
  if (normalizedPattern.startsWith("*.")) {
    if (isIP3(host)) return false;
    const base = normalizedPattern.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === normalizedPattern;
}
function allowsAllDomains(allowedDomains) {
  return allowedDomains?.includes("*") ?? false;
}
function domainIsAllowed(domain, allowedDomains) {
  return allowedDomains.some((p) => domainMatchesPattern(domain, p));
}
function createNetworkAskCallback(allowedDomains) {
  return async ({ host }) => domainIsAllowed(host, allowedDomains);
}
var directMacSandboxViolations = [];
var stopDirectMacSandboxLogMonitor;
function rememberDirectMacSandboxViolation(violation) {
  directMacSandboxViolations.push(violation);
  if (directMacSandboxViolations.length > 100) {
    directMacSandboxViolations.splice(0, directMacSandboxViolations.length - 100);
  }
}
function getDirectMacSandboxViolationsForCommand(command) {
  const encodedCommand = encodeSandboxedCommand(command);
  return directMacSandboxViolations.filter(
    (violation) => violation.command === command || violation.encodedCommand === encodedCommand
  );
}
function restartDirectMacSandboxLogMonitor(ignoreViolations) {
  if (process.platform !== "darwin") return;
  stopDirectMacSandboxLogMonitor?.();
  directMacSandboxViolations.length = 0;
  stopDirectMacSandboxLogMonitor = startDirectMacSandboxLogMonitor(
    rememberDirectMacSandboxViolation,
    ignoreViolations
  );
}
function stopDirectMacSandboxMonitoring() {
  stopDirectMacSandboxLogMonitor?.();
  stopDirectMacSandboxLogMonitor = void 0;
  directMacSandboxViolations.length = 0;
}
var SANDBOX_DENIAL_OUTPUT_PATTERN = /(?:Operation not permitted|Permission denied|Read-only file system)/i;
var MAX_SANDBOX_PERMISSION_RETRIES = 20;
function sleep(ms) {
  return new Promise((resolve5) => setTimeout(resolve5, ms));
}
function bashOutputLooksLikeSandboxDenial(content) {
  return content.some(
    (part) => part.type === "text" && typeof part.text === "string" && SANDBOX_DENIAL_OUTPUT_PATTERN.test(part.text)
  );
}
function getViolationTimestampMs(violation) {
  if (violation.timestamp === void 0) return void 0;
  if (violation.timestamp instanceof Date) return violation.timestamp.getTime();
  if (typeof violation.timestamp === "number") return violation.timestamp;
  const parsed = Date.parse(violation.timestamp);
  return Number.isNaN(parsed) ? void 0 : parsed;
}
function getSandboxViolationsForCommand(command, sinceMs) {
  const violations = [
    ...SandboxManager.getSandboxViolationStore?.().getViolationsForCommand(command) ?? [],
    ...getDirectMacSandboxViolationsForCommand(command)
  ];
  if (sinceMs === void 0) return violations;
  return violations.filter((violation) => {
    const timestampMs = getViolationTimestampMs(violation);
    return timestampMs !== void 0 && timestampMs >= sinceMs;
  });
}
function getSandboxFilesystemViolationsForCommand(command, sinceMs) {
  const filesystemViolations = [];
  for (const violation of getSandboxViolationsForCommand(command, sinceMs)) {
    const filesystemViolation = parseSandboxFilesystemViolationLine(violation.line);
    if (filesystemViolation) filesystemViolations.push(filesystemViolation);
  }
  return filesystemViolations;
}
async function waitForSandboxFilesystemViolationsForCommand(command, sinceMs) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(50);
    const violations = getSandboxFilesystemViolationsForCommand(command, sinceMs);
    if (violations.length > 0) return violations;
  }
  return [];
}
function getFilesystemViolationKey(violation) {
  return `${violation.access}:${canonicalizePath(violation.path)}`;
}
function dedupeFilesystemViolations(violations) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const violation of violations) {
    const key = getFilesystemViolationKey(violation);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(violation);
  }
  return deduped;
}
async function getFilesystemViolationsForFailedBashResult(command, content, sinceMs) {
  let violations = getSandboxFilesystemViolationsForCommand(command, sinceMs);
  if (violations.length > 0) return dedupeFilesystemViolations(violations);
  if (!bashOutputLooksLikeSandboxDenial(content)) return null;
  violations = await waitForSandboxFilesystemViolationsForCommand(command, sinceMs);
  return dedupeFilesystemViolations(violations);
}
function expandPath(filePath) {
  const expanded = filePath.replace(/^~(?=$|\/)/, homedir4());
  return resolve4(expanded);
}
function canonicalizePath(filePath) {
  const abs = expandPath(filePath);
  try {
    return realpathSync5.native(abs);
  } catch {
    const tail = [];
    let probe = abs;
    while (!existsSync5(probe)) {
      const parent = dirname5(probe);
      if (parent === probe) return abs;
      tail.unshift(basename(probe));
      probe = parent;
    }
    try {
      return resolve4(realpathSync5.native(probe), ...tail);
    } catch {
      return abs;
    }
  }
}
function matchesPattern(filePath, patterns) {
  const abs = canonicalizePath(filePath);
  return patterns.some((p) => {
    const absP = p.includes("*") ? expandPath(p) : canonicalizePath(p);
    if (p.includes("*")) {
      const escaped = absP.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(abs);
    }
    const sep = absP.endsWith("/") ? "" : "/";
    return abs === absP || abs.startsWith(absP + sep);
  });
}
function getConfigPaths(cwd) {
  return {
    globalPath: join4(homedir4(), ".pi", "agent", "sandbox.json"),
    projectPath: join4(cwd, ".pi", "sandbox.json")
  };
}
function readOrEmptyConfig(configPath) {
  if (!existsSync5(configPath)) return {};
  try {
    return JSON.parse(readFileSync2(configPath, "utf-8"));
  } catch {
    return {};
  }
}
function writeConfigFile(configPath, config2) {
  runWithWriteLockBypass(() => {
    mkdirSync(dirname5(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(config2, null, 2) + "\n", "utf-8");
  });
}
function addDomainToConfig(configPath, domain) {
  const config2 = readOrEmptyConfig(configPath);
  const existing = config2.network?.allowedDomains ?? [];
  if (!existing.includes(domain)) {
    config2.network = {
      ...config2.network,
      allowedDomains: [...existing, domain],
      deniedDomains: config2.network?.deniedDomains ?? []
    };
    writeConfigFile(configPath, config2);
  }
}
function addReadPathToConfig(configPath, pathToAdd) {
  const config2 = readOrEmptyConfig(configPath);
  const existing = config2.filesystem?.allowRead ?? [];
  if (!existing.includes(pathToAdd)) {
    config2.filesystem = {
      ...config2.filesystem,
      allowRead: [...existing, pathToAdd],
      denyRead: config2.filesystem?.denyRead ?? [],
      allowWrite: config2.filesystem?.allowWrite ?? [],
      denyWrite: config2.filesystem?.denyWrite ?? []
    };
    writeConfigFile(configPath, config2);
  }
}
function addWritePathToConfig(configPath, pathToAdd) {
  const config2 = readOrEmptyConfig(configPath);
  const existing = config2.filesystem?.allowWrite ?? [];
  if (!existing.includes(pathToAdd)) {
    config2.filesystem = {
      ...config2.filesystem,
      allowWrite: [...existing, pathToAdd],
      denyRead: config2.filesystem?.denyRead ?? [],
      denyWrite: config2.filesystem?.denyWrite ?? []
    };
    writeConfigFile(configPath, config2);
  }
}
function execSpawnedCommand(file, args, cwd, { onData, signal, timeout, env }, cleanup) {
  return new Promise((resolve5, reject) => {
    const child = spawn5(file, args, {
      cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let timedOut = false;
    let timeoutHandle;
    let cleanupDone = false;
    const cleanupAfterSpawn = () => {
      if (cleanupDone) return;
      cleanupDone = true;
      try {
        cleanup?.();
      } catch {
      }
      try {
        SandboxManager.cleanupAfterCommand();
      } catch {
      }
    };
    if (timeout !== void 0 && timeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        }
      }, timeout * 1e3);
    }
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      cleanupAfterSpawn();
      reject(err);
    });
    const onAbort = () => {
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      signal?.removeEventListener("abort", onAbort);
      cleanupAfterSpawn();
      if (signal?.aborted) {
        reject(new Error("aborted"));
      } else if (timedOut) {
        reject(new Error(`timeout:${timeout}`));
      } else {
        resolve5({ exitCode: code });
      }
    });
  });
}
function createSandboxedBashOps(shellPath, fallback, isEnabled = () => SandboxManager.isSandboxingEnabled()) {
  return {
    async exec(command, cwd, options) {
      if (!existsSync5(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      const { shell, args } = getShellConfig(shellPath);
      if (!isEnabled() || !SandboxManager.isSandboxingEnabled()) {
        if (fallback) return fallback.exec(command, cwd, options);
        return execSpawnedCommand(shell, [...args, command], cwd, options);
      }
      if (process.platform === "darwin") {
        const runtimeConfig = SandboxManager.getConfig();
        const commandSpec = createDirectMacSandboxCommand({
          command,
          shell,
          needsNetworkRestriction: runtimeConfig?.network?.allowedDomains !== void 0,
          httpProxyPort: SandboxManager.getProxyPort(),
          socksProxyPort: SandboxManager.getSocksProxyPort(),
          allowUnixSockets: runtimeConfig?.network?.allowUnixSockets,
          allowAllUnixSockets: runtimeConfig?.network?.allowAllUnixSockets,
          allowLocalBinding: runtimeConfig?.network?.allowLocalBinding,
          allowMachLookup: runtimeConfig?.network?.allowMachLookup,
          readConfig: SandboxManager.getFsReadConfig(),
          writeConfig: SandboxManager.getFsWriteConfig(),
          allowPty: runtimeConfig?.allowPty,
          allowBrowserProcess: runtimeConfig?.allowBrowserProcess,
          allowGitConfig: runtimeConfig?.filesystem?.allowGitConfig,
          enableWeakerNetworkIsolation: runtimeConfig?.enableWeakerNetworkIsolation
        });
        return execSpawnedCommand(commandSpec.file, commandSpec.args, cwd, options);
      }
      if (process.platform === "linux") {
        const runtimeConfig = SandboxManager.getConfig();
        const needsNetworkRestriction = runtimeConfig?.network?.allowedDomains !== void 0;
        if (needsNetworkRestriction) await SandboxManager.waitForNetworkInitialization();
        const commandSpec = await createDirectLinuxSandboxCommand({
          command,
          shell,
          needsNetworkRestriction,
          httpSocketPath: needsNetworkRestriction ? SandboxManager.getLinuxHttpSocketPath() : void 0,
          socksSocketPath: needsNetworkRestriction ? SandboxManager.getLinuxSocksSocketPath() : void 0,
          httpProxyPort: needsNetworkRestriction ? SandboxManager.getProxyPort() : void 0,
          socksProxyPort: needsNetworkRestriction ? SandboxManager.getSocksProxyPort() : void 0,
          readConfig: SandboxManager.getFsReadConfig(),
          writeConfig: SandboxManager.getFsWriteConfig(),
          enableWeakerNestedSandbox: runtimeConfig?.enableWeakerNestedSandbox,
          allowAllUnixSockets: runtimeConfig?.network?.allowAllUnixSockets,
          ripgrepConfig: runtimeConfig?.ripgrep,
          mandatoryDenySearchDepth: runtimeConfig?.mandatoryDenySearchDepth,
          allowGitConfig: runtimeConfig?.filesystem?.allowGitConfig,
          seccompConfig: runtimeConfig?.seccomp,
          abortSignal: options.signal
        });
        return execSpawnedCommand(
          commandSpec.file,
          commandSpec.args,
          cwd,
          options,
          commandSpec.cleanup
        );
      }
      const directCommand = [shell, ...args, command];
      return execSpawnedCommand(directCommand[0], directCommand.slice(1), cwd, options);
    }
  };
}
function index_default(pi) {
  pi.registerFlag("no-sandbox", {
    description: "Disable OS-level sandboxing for bash commands",
    type: "boolean",
    default: false
  });
  const localCwd = process.cwd();
  const userShellPath = SettingsManager.create(localCwd).getShellPath();
  let sandboxEnabled = true;
  let sandboxInitialized = false;
  const sessionAllowedDomains = [];
  const sessionAllowedReadPaths = [];
  const sessionAllowedWritePaths = [];
  const pendingSandboxedBash = /* @__PURE__ */ new Map();
  const readOnlyWriteLocks = /* @__PURE__ */ new Map();
  let lastStatusContext;
  let sandboxConfigEnabledOverride;
  registerBashToolPlugin(pi, {
    id: "pi-sandbox",
    priority: -100,
    wrapOperations: (next) => createSandboxedBashOps(userShellPath, next, () => sandboxEnabled && sandboxInitialized)
  });
  function uniqueStrings(values) {
    return [...new Set(values)];
  }
  function isReadOnlyWriteLocked() {
    return readOnlyWriteLocks.size > 0;
  }
  function hasGlobalReadOnlyWriteLock() {
    return [...readOnlyWriteLocks.values()].some((lock) => lock.scope === "global");
  }
  function getScopedReadOnlyWriteLockPaths() {
    return uniqueStrings(
      [...readOnlyWriteLocks.values()].filter((lock) => lock.scope === "cwd").map((lock) => lock.cwd)
    );
  }
  function matchesReadOnlyWriteLock(filePath) {
    if (!isReadOnlyWriteLocked()) return false;
    if (hasGlobalReadOnlyWriteLock()) return true;
    const lockedPaths = getScopedReadOnlyWriteLockPaths();
    return lockedPaths.length > 0 && matchesPattern(filePath, lockedPaths);
  }
  function isProcessWriteDeniedByReadOnlyLock(target) {
    if (!sandboxEnabled || !isReadOnlyWriteLocked()) return false;
    if (hasGlobalReadOnlyWriteLock()) return !isProcessWriteAllowedByPath(target);
    const targetPath = getFsTargetPath(target);
    return targetPath !== void 0 && matchesReadOnlyWriteLock(targetPath);
  }
  function getReadOnlyWriteLockSignature() {
    return [...readOnlyWriteLocks].map(([owner, lock]) => `${owner}:${lock.scope}:${lock.cwd}`).sort().join("|");
  }
  function describeReadOnlyWriteLocks() {
    if (readOnlyWriteLocks.size === 0) return "(none)";
    return [...readOnlyWriteLocks].map(([owner, lock]) => `${owner}:${lock.scope === "cwd" ? lock.cwd : "global"}`).join(", ");
  }
  function clearReadOnlyWriteLocks() {
    readOnlyWriteLocks.clear();
  }
  patchFsWriteApis((target) => isProcessWriteDeniedByReadOnlyLock(target));
  function applyReadOnlyWriteLock(config2) {
    if (!isReadOnlyWriteLocked()) return config2;
    const scopedDenyWrite = getScopedReadOnlyWriteLockPaths();
    const globalLocked = hasGlobalReadOnlyWriteLock();
    return {
      ...config2,
      filesystem: {
        ...config2.filesystem,
        allowWrite: globalLocked ? [] : config2.filesystem?.allowWrite ?? [],
        denyWrite: uniqueStrings([
          ...config2.filesystem?.denyWrite ?? [],
          ...scopedDenyWrite,
          ...globalLocked ? READ_ONLY_LOCK_DENY_WRITE_PATHS : []
        ])
      }
    };
  }
  function getEffectiveConfig(cwd) {
    const config2 = applyReadOnlyWriteLock(loadConfig(cwd));
    if (sandboxConfigEnabledOverride === void 0) return config2;
    return { ...config2, enabled: sandboxConfigEnabledOverride };
  }
  function canUseSandbox(cwd) {
    if (pi.getFlag("no-sandbox") === true)
      return { ok: false, reason: "sandbox disabled via --no-sandbox" };
    if (!sandboxEnabled && lastStatusContext !== void 0) {
      return { ok: false, reason: "sandbox disabled for this session" };
    }
    const config2 = getEffectiveConfig(cwd);
    if (!config2.enabled) return { ok: false, reason: "sandbox disabled via config" };
    const platform = process.platform;
    if (platform !== "darwin" && platform !== "linux") {
      return { ok: false, reason: `sandbox not supported on ${platform}` };
    }
    return { ok: true };
  }
  function updateSandboxStatus(ctx) {
    lastStatusContext = ctx;
    if (!sandboxEnabled) {
      ctx.ui.setStatus("sandbox", void 0);
      return;
    }
    const config2 = getEffectiveConfig(ctx.cwd);
    const networkLabel = allowsAllDomains(config2.network?.allowedDomains) ? "all domains" : `${config2.network?.allowedDomains?.length ?? 0} domains`;
    const lockScopeLabel = hasGlobalReadOnlyWriteLock() ? "read-only" : "cwd write lock";
    const writeLabel = isReadOnlyWriteLocked() ? `${lockScopeLabel} (${readOnlyWriteLocks.size} lock${readOnlyWriteLocks.size === 1 ? "" : "s"})` : `${config2.filesystem?.allowWrite?.length ?? 0} write paths`;
    ctx.ui.setStatus(
      "sandbox",
      ctx.ui.theme.fg("accent", `\u{1F512} Sandbox: ${networkLabel}, ${writeLabel}`)
    );
  }
  function setNodeEnvProxyIfSupported() {
    const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
    const supportsEnvProxy = nodeMajor === 22 && (nodeMinor ?? 0) >= 21 || (nodeMajor ?? 0) >= 24;
    if (supportsEnvProxy) {
      process.env.NODE_USE_ENV_PROXY ??= "1";
    }
  }
  async function initializeSandboxFromConfig(config2) {
    const configExt = config2;
    await runWithWriteLockBypass(async () => {
      await SandboxManager.initialize(
        {
          network: config2.network,
          filesystem: config2.filesystem,
          ignoreViolations: configExt.ignoreViolations,
          enableWeakerNestedSandbox: configExt.enableWeakerNestedSandbox,
          allowBrowserProcess: configExt.allowBrowserProcess,
          enableWeakerNetworkIsolation: true
        },
        createNetworkAskCallback(config2.network?.allowedDomains ?? []),
        true
      );
      restartDirectMacSandboxLogMonitor(configExt.ignoreViolations);
    });
    setNodeEnvProxyIfSupported();
  }
  async function enableSandbox(ctx, options = {}) {
    const platform = process.platform;
    if (pi.getFlag("no-sandbox") === true) {
      sandboxEnabled = false;
      sandboxInitialized = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      return {
        accepted: false,
        enabled: false,
        initialized: false,
        reason: "sandbox disabled via --no-sandbox"
      };
    }
    if (platform !== "darwin" && platform !== "linux") {
      sandboxEnabled = false;
      sandboxInitialized = false;
      updateSandboxStatus(ctx);
      return {
        accepted: false,
        enabled: false,
        initialized: false,
        reason: `sandbox not supported on ${platform}`
      };
    }
    const previousOverride = sandboxConfigEnabledOverride;
    if (options.overrideConfig) sandboxConfigEnabledOverride = true;
    const config2 = getEffectiveConfig(ctx.cwd);
    if (!config2.enabled) {
      sandboxEnabled = false;
      sandboxInitialized = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      return {
        accepted: false,
        enabled: false,
        initialized: false,
        reason: "sandbox disabled via config"
      };
    }
    if (sandboxInitialized) {
      try {
        await runWithWriteLockBypass(() => SandboxManager.reset());
      } catch {
      }
      stopDirectMacSandboxMonitoring();
      sandboxInitialized = false;
    }
    try {
      await initializeSandboxFromConfig(config2);
      sandboxEnabled = true;
      sandboxInitialized = true;
      updateSandboxStatus(ctx);
      return { accepted: true, enabled: true, initialized: true };
    } catch (err) {
      sandboxConfigEnabledOverride = previousOverride;
      sandboxEnabled = false;
      sandboxInitialized = false;
      stopDirectMacSandboxMonitoring();
      updateSandboxStatus(ctx);
      return {
        accepted: false,
        enabled: false,
        initialized: false,
        reason: `Sandbox initialization failed: ${err instanceof Error ? err.message : err}`
      };
    }
  }
  async function disableSandbox(ctx, options = {}) {
    if (options.overrideConfig) sandboxConfigEnabledOverride = false;
    clearReadOnlyWriteLocks();
    stopDirectMacSandboxMonitoring();
    if (sandboxInitialized) {
      try {
        await runWithWriteLockBypass(() => SandboxManager.reset());
      } catch {
      }
    }
    sandboxEnabled = false;
    sandboxInitialized = false;
    updateSandboxStatus(ctx);
    return { accepted: true, enabled: false, initialized: false };
  }
  function getSandboxState(cwd) {
    const config2 = getEffectiveConfig(cwd);
    const noSandbox = pi.getFlag("no-sandbox") === true;
    const supported = process.platform === "darwin" || process.platform === "linux";
    const configured = config2.enabled ?? true;
    const enabled = sandboxEnabled && sandboxInitialized && configured && !noSandbox && supported;
    const reason = noSandbox ? "sandbox disabled via --no-sandbox" : !supported ? `sandbox not supported on ${process.platform}` : !config2.enabled ? "sandbox disabled via config" : !sandboxEnabled ? "sandbox disabled for this session" : !sandboxInitialized ? "sandbox not initialized" : void 0;
    return {
      available: true,
      enabled,
      initialized: sandboxInitialized,
      configured,
      noSandbox,
      supported,
      reason
    };
  }
  async function setReadOnlyWriteLock(enabled, owner, cwd, scope) {
    const previousLockSignature = getReadOnlyWriteLockSignature();
    if (!enabled) {
      readOnlyWriteLocks.delete(owner);
      const active2 = isReadOnlyWriteLocked();
      if (sandboxInitialized && previousLockSignature !== getReadOnlyWriteLockSignature()) {
        await reinitializeSandbox(cwd);
      }
      if (lastStatusContext) updateSandboxStatus(lastStatusContext);
      return {
        accepted: true,
        active: active2,
        reason: active2 ? `write lock active: ${describeReadOnlyWriteLocks()}` : void 0
      };
    }
    const availability = canUseSandbox(cwd);
    if (!availability.ok) {
      readOnlyWriteLocks.delete(owner);
      return { accepted: false, active: isReadOnlyWriteLocked(), reason: availability.reason };
    }
    readOnlyWriteLocks.set(owner, { scope, cwd: canonicalizePath(cwd) });
    const active = isReadOnlyWriteLocked();
    if (sandboxInitialized && previousLockSignature !== getReadOnlyWriteLockSignature()) {
      await reinitializeSandbox(cwd);
    }
    if (lastStatusContext) updateSandboxStatus(lastStatusContext);
    return {
      accepted: true,
      active,
      reason: active ? `write lock active: ${describeReadOnlyWriteLocks()}` : void 0
    };
  }
  pi.events.on("pi-sandbox:request-state", (data) => {
    const request = data && typeof data === "object" ? data : {};
    const cwd = request.cwd || lastStatusContext?.cwd || localCwd;
    request.respond?.(getSandboxState(cwd));
  });
  pi.events.on("pi-sandbox:set-enabled", (data) => {
    const request = data && typeof data === "object" ? data : {};
    const ctx = request.ctx ?? lastStatusContext;
    if (typeof request.enabled !== "boolean") {
      const state = getSandboxState(request.cwd || ctx?.cwd || localCwd);
      request.respond?.({
        accepted: false,
        enabled: state.enabled,
        initialized: state.initialized,
        reason: "Missing boolean enabled value"
      });
      return;
    }
    if (!ctx) {
      request.respond?.({
        accepted: false,
        enabled: sandboxEnabled && sandboxInitialized,
        initialized: sandboxInitialized,
        reason: "No active sandbox session"
      });
      return;
    }
    const result = request.enabled ? enableSandbox(ctx, { overrideConfig: true }) : disableSandbox(ctx, { overrideConfig: true });
    request.respond?.(result);
  });
  pi.events.on("pi-sandbox:set-read-only-lock", (data) => {
    const request = data;
    const owner = request.owner || "unknown";
    const cwd = request.cwd || localCwd;
    const scope = request.scope === "cwd" ? "cwd" : "global";
    request.respond?.(setReadOnlyWriteLock(request.enabled === true, owner, cwd, scope));
  });
  function getEffectiveAllowedDomains(cwd) {
    const config2 = getEffectiveConfig(cwd);
    return [...config2.network?.allowedDomains ?? [], ...sessionAllowedDomains];
  }
  function getEffectiveAllowWrite(cwd) {
    if (hasGlobalReadOnlyWriteLock()) return [];
    const config2 = getEffectiveConfig(cwd);
    return [...config2.filesystem?.allowWrite ?? [], ...sessionAllowedWritePaths];
  }
  async function reinitializeSandbox(cwd) {
    if (!sandboxInitialized) return;
    const config2 = getEffectiveConfig(cwd);
    const configExt = config2;
    try {
      const network = {
        ...config2.network,
        allowedDomains: [...config2.network?.allowedDomains ?? [], ...sessionAllowedDomains],
        deniedDomains: config2.network?.deniedDomains ?? []
      };
      await runWithWriteLockBypass(async () => {
        await SandboxManager.reset();
        await SandboxManager.initialize(
          {
            network,
            filesystem: {
              ...config2.filesystem,
              denyRead: config2.filesystem?.denyRead ?? [],
              allowRead: [...config2.filesystem?.allowRead ?? [], ...sessionAllowedReadPaths],
              allowWrite: [
                ...config2.filesystem?.allowWrite ?? [],
                ...isReadOnlyWriteLocked() ? [] : sessionAllowedWritePaths
              ],
              denyWrite: config2.filesystem?.denyWrite ?? []
            },
            allowBrowserProcess: configExt.allowBrowserProcess,
            enableWeakerNetworkIsolation: true
          },
          createNetworkAskCallback(network.allowedDomains),
          true
        );
        restartDirectMacSandboxLogMonitor(configExt.ignoreViolations);
      });
    } catch (e) {
      console.error(`Warning: Failed to reinitialize sandbox: ${e}`);
    }
  }
  const DOMAIN_PERMISSION_OPTIONS = [
    { label: "Allow for this session only", key: "s", action: "session" },
    { label: "Abort (keep blocked)", key: "esc", action: "abort" },
    {
      label: "Allow for this project",
      key: "P",
      action: "project",
      confirm: true,
      hint: "\u2192 .pi/sandbox.json"
    },
    {
      label: "Allow for all projects",
      key: "A",
      action: "global",
      confirm: true,
      hint: "\u2192 ~/.pi/agent/sandbox.json"
    }
  ];
  const FILESYSTEM_PERMISSION_OPTIONS = [
    { label: "Allow this file for this session only", key: "s", action: "session-file" },
    { label: "Allow containing folder for this session only", key: "d", action: "session-dir" },
    { label: "Abort (keep blocked)", key: "esc", action: "abort" },
    {
      label: "Allow for this project",
      key: "P",
      action: "project",
      confirm: true,
      hint: "\u2192 .pi/sandbox.json"
    },
    {
      label: "Allow for all projects",
      key: "A",
      action: "global",
      confirm: true,
      hint: "\u2192 ~/.pi/agent/sandbox.json"
    }
  ];
  async function showPermissionPrompt(ctx, title, options) {
    if (!ctx.hasUI) return "abort";
    const result = await ctx.ui.custom((tui, theme, _kb, done) => {
      let selectedIndex = 0;
      let pendingAction = null;
      function resolve5(action) {
        done(action);
      }
      return {
        render(width) {
          const lines = [];
          lines.push(truncateToWidth(theme.fg("warning", title), width));
          lines.push("");
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const isSelected = i === selectedIndex;
            const isPending = pendingAction === opt.action;
            const prefix = isSelected ? " \u2192 " : "   ";
            const keyHint = theme.fg("accent", `[${opt.key}]`);
            let label = opt.label;
            if (opt.hint) {
              label += `  ${theme.fg("dim", opt.hint)}`;
            }
            if (isPending) {
              label += `  ${theme.fg("warning", "\u2192 press Enter to confirm")}`;
            }
            const line = `${prefix}${keyHint} ${label}`;
            lines.push(truncateToWidth(line, width));
          }
          lines.push("");
          const footer = pendingAction ? "\u2191\u2193 navigate  enter confirm  esc cancel" : "\u2191\u2193 navigate  enter select  esc/ctrl+c cancel";
          lines.push(truncateToWidth(theme.fg("dim", footer), width));
          return lines;
        },
        handleInput(data) {
          if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
            resolve5("abort");
            return;
          }
          if (matchesKey(data, Key.enter)) {
            if (pendingAction) {
              resolve5(pendingAction);
            } else {
              resolve5(options[selectedIndex]?.action ?? "abort");
            }
            return;
          }
          if (matchesKey(data, Key.up)) {
            selectedIndex = Math.max(0, selectedIndex - 1);
            pendingAction = null;
            tui.requestRender();
            return;
          }
          if (matchesKey(data, Key.down)) {
            selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
            pendingAction = null;
            tui.requestRender();
            return;
          }
          for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (data === opt.key) {
              resolve5(opt.action);
              return;
            }
            if (data.toLowerCase() === opt.key.toLowerCase()) {
              if (opt.confirm) {
                pendingAction = opt.action;
                selectedIndex = i;
              } else {
                resolve5(opt.action);
              }
              tui.requestRender();
              return;
            }
          }
        },
        invalidate() {
        }
      };
    });
    return result ?? "abort";
  }
  async function promptDomainBlock(ctx, domain) {
    return showPermissionPrompt(
      ctx,
      `\u{1F310} Network blocked: "${domain}" is not in allowedDomains`,
      DOMAIN_PERMISSION_OPTIONS
    );
  }
  async function promptReadBlock(ctx, filePath, reason) {
    const reasonText = reason === "denyRead" ? "is in denyRead" : "is not in allowRead";
    return showPermissionPrompt(
      ctx,
      `\u{1F4D6} Read blocked: "${filePath}" ${reasonText}`,
      FILESYSTEM_PERMISSION_OPTIONS
    );
  }
  async function promptWriteBlock(ctx, filePath) {
    return showPermissionPrompt(
      ctx,
      `\u{1F4DD} Write blocked: "${filePath}" is not in allowWrite`,
      FILESYSTEM_PERMISSION_OPTIONS
    );
  }
  async function applyDomainChoice(choice, domain, cwd) {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    if (!sessionAllowedDomains.includes(domain)) sessionAllowedDomains.push(domain);
    if (choice === "project") addDomainToConfig(projectPath, domain);
    if (choice === "global") addDomainToConfig(globalPath, domain);
    await reinitializeSandbox(cwd);
  }
  function getSessionFilesystemAllowancePath(choice, filePath) {
    return choice === "session-dir" ? dirname5(filePath) : filePath;
  }
  async function applyReadChoice(choice, filePath, cwd) {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    const sessionPath = getSessionFilesystemAllowancePath(choice, filePath);
    if (!sessionAllowedReadPaths.includes(sessionPath)) sessionAllowedReadPaths.push(sessionPath);
    if (choice === "project") addReadPathToConfig(projectPath, filePath);
    if (choice === "global") addReadPathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }
  async function applyWriteChoice(choice, filePath, cwd) {
    const { globalPath, projectPath } = getConfigPaths(cwd);
    const sessionPath = getSessionFilesystemAllowancePath(choice, filePath);
    if (!sessionAllowedWritePaths.includes(sessionPath)) sessionAllowedWritePaths.push(sessionPath);
    if (choice === "project") addWritePathToConfig(projectPath, filePath);
    if (choice === "global") addWritePathToConfig(globalPath, filePath);
    await reinitializeSandbox(cwd);
  }
  async function retrySandboxedBash(toolCallId, params, ctx) {
    const sandboxedBash = createBashToolDefinition2(ctx.cwd, {
      operations: createSandboxedBashOps(userShellPath),
      shellPath: userShellPath
    });
    try {
      const result = await sandboxedBash.execute(toolCallId, params, ctx.signal, void 0, ctx);
      return {
        content: result.content,
        details: result.details,
        isError: false
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ],
        details: void 0,
        isError: true
      };
    }
  }
  pi.on("user_bash", async (event, ctx) => {
    if (!sandboxEnabled || !sandboxInitialized) return;
    const domains = extractDomainsFromCommand(event.command);
    const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);
    for (const domain of domains) {
      if (!domainIsAllowed(domain, effectiveDomains)) {
        const choice = await promptDomainBlock(ctx, domain);
        if (choice === "abort") {
          return {
            result: {
              output: `Blocked: "${domain}" is not in allowedDomains. Use /sandbox to review your config.`,
              exitCode: 1,
              cancelled: false,
              truncated: false
            }
          };
        }
        await applyDomainChoice(choice, domain, ctx.cwd);
      }
    }
    return {
      operations: createSandboxedBashOps(
        userShellPath,
        void 0,
        () => sandboxEnabled && sandboxInitialized
      )
    };
  });
  pi.on("tool_call", async (event, ctx) => {
    if (!sandboxEnabled) return;
    const config2 = getEffectiveConfig(ctx.cwd);
    if (!config2.enabled) return;
    const { projectPath, globalPath } = getConfigPaths(ctx.cwd);
    if (sandboxInitialized && isToolCallEventType("bash", event)) {
      const originalCommand = event.input.command;
      const domains = extractDomainsFromCommand(originalCommand);
      const effectiveDomains = getEffectiveAllowedDomains(ctx.cwd);
      for (const domain of domains) {
        if (!domainIsAllowed(domain, effectiveDomains)) {
          const choice = await promptDomainBlock(ctx, domain);
          if (choice === "abort") {
            return {
              block: true,
              reason: `Network access to "${domain}" is blocked (not in allowedDomains).`
            };
          }
          await applyDomainChoice(choice, domain, ctx.cwd);
        }
      }
      pendingSandboxedBash.set(event.toolCallId, {
        command: originalCommand,
        timeout: event.input.timeout,
        startedAt: Date.now()
      });
      return;
    }
    if (isToolCallEventType("read", event)) {
      const filePath = canonicalizePath(event.input.path);
      const readBlockReason = getReadBlockReason(
        filePath,
        config2.filesystem?.denyRead ?? [],
        config2.filesystem?.allowRead ?? [],
        sessionAllowedReadPaths,
        matchesPattern
      );
      if (readBlockReason) {
        const choice = await promptReadBlock(ctx, filePath, readBlockReason);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: read access denied for "${filePath}"`
          };
        }
        await applyReadChoice(choice, filePath, ctx.cwd);
        return;
      }
    }
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path6 = canonicalizePath(event.input.path);
      if (matchesReadOnlyWriteLock(path6)) {
        return {
          block: true,
          reason: `Sandbox read-only lock: write access denied for "${path6}"`
        };
      }
    }
    if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
      const path6 = canonicalizePath(event.input.path);
      const allowWrite = getEffectiveAllowWrite(ctx.cwd);
      const denyWrite = config2.filesystem?.denyWrite ?? [];
      if (shouldPromptForWrite(path6, allowWrite, matchesPattern)) {
        const choice = await promptWriteBlock(ctx, path6);
        if (choice === "abort") {
          return {
            block: true,
            reason: `Sandbox: write access denied for "${path6}" (not in allowWrite)`
          };
        }
        await applyWriteChoice(choice, path6, ctx.cwd);
        if (matchesPattern(path6, denyWrite)) {
          ctx.ui.notify(
            `\u26A0\uFE0F "${path6}" was added to allowWrite, but it is also in denyWrite and will remain blocked.
Check denyWrite in:
  ${projectPath}
  ${globalPath}`,
            "warning"
          );
          return {
            block: true,
            reason: `Sandbox: write access denied for "${path6}" (also in denyWrite)`
          };
        }
        return;
      }
      if (matchesPattern(path6, denyWrite)) {
        return {
          block: true,
          reason: `Sandbox: write access denied for "${path6}" (in denyWrite). To change this, edit denyWrite in:
  ${projectPath}
  ${globalPath}`
        };
      }
    }
  });
  function appendSandboxErrorResult(result, text2) {
    return {
      content: [
        ...result.content,
        {
          type: "text",
          text: text2
        }
      ],
      details: result.details,
      isError: true
    };
  }
  function deniedFilesystemViolationResult(result, violation, blockedPath, reason) {
    return appendSandboxErrorResult(
      result,
      reason ?? `Sandbox: ${violation.access} access denied for "${blockedPath}"`
    );
  }
  async function allowSandboxFilesystemViolation(violation, result, ctx) {
    const blockedPath = canonicalizePath(violation.path);
    if (!ctx.hasUI || violation.access === "write" && matchesReadOnlyWriteLock(blockedPath)) {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(result, violation, blockedPath)
      };
    }
    const config2 = getEffectiveConfig(ctx.cwd);
    const { projectPath, globalPath } = getConfigPaths(ctx.cwd);
    if (violation.access === "read") {
      const readBlockReason = getReadBlockReason(
        blockedPath,
        config2.filesystem?.denyRead ?? [],
        config2.filesystem?.allowRead ?? [],
        sessionAllowedReadPaths,
        matchesPattern
      );
      if (!readBlockReason) {
        if (matchesPattern(blockedPath, sessionAllowedReadPaths)) {
          return { allowed: true, granted: { access: "read", path: blockedPath } };
        }
        return {
          allowed: false,
          result: deniedFilesystemViolationResult(
            result,
            violation,
            blockedPath,
            `Sandbox: read access denied for "${blockedPath}", but this path already matches the read policy. Check the OS-level sandbox path normalization.`
          )
        };
      }
      const choice2 = await promptReadBlock(ctx, blockedPath, readBlockReason);
      if (choice2 === "abort") {
        return {
          allowed: false,
          result: deniedFilesystemViolationResult(result, violation, blockedPath)
        };
      }
      const grantedPath2 = getSessionFilesystemAllowancePath(choice2, blockedPath);
      await applyReadChoice(choice2, blockedPath, ctx.cwd);
      return { allowed: true, granted: { access: "read", path: grantedPath2 } };
    }
    const denyWrite = config2.filesystem?.denyWrite ?? [];
    if (matchesPattern(blockedPath, denyWrite)) {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(
          result,
          violation,
          blockedPath,
          `Sandbox: write access denied for "${blockedPath}" (in denyWrite). To change this, edit denyWrite in:
  ${projectPath}
  ${globalPath}`
        )
      };
    }
    const allowWrite = getEffectiveAllowWrite(ctx.cwd);
    if (!shouldPromptForWrite(blockedPath, allowWrite, matchesPattern)) {
      if (matchesPattern(blockedPath, sessionAllowedWritePaths)) {
        return { allowed: true, granted: { access: "write", path: blockedPath } };
      }
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(
          result,
          violation,
          blockedPath,
          `Sandbox: write access denied for "${blockedPath}", but this path already matches allowWrite. Check the OS-level sandbox path normalization.`
        )
      };
    }
    const choice = await promptWriteBlock(ctx, blockedPath);
    if (choice === "abort") {
      return {
        allowed: false,
        result: deniedFilesystemViolationResult(result, violation, blockedPath)
      };
    }
    const grantedPath = getSessionFilesystemAllowancePath(choice, blockedPath);
    await applyWriteChoice(choice, blockedPath, ctx.cwd);
    return { allowed: true, granted: { access: "write", path: grantedPath } };
  }
  function notifySandboxRetry(ctx, granted) {
    if (granted.length === 1) {
      const [{ access, path: path6 }] = granted;
      const label = access === "read" ? "Read" : "Write";
      ctx.ui.notify(`${label} access granted for "${path6}", retrying bash command`, "info");
      return;
    }
    ctx.ui.notify(`${granted.length} sandbox accesses granted, retrying bash command`, "info");
  }
  pi.on("tool_result", async (event, ctx) => {
    if (!sandboxEnabled || !sandboxInitialized) return;
    if (event.toolName !== "bash") return;
    if (!event.isError) return;
    const original = pendingSandboxedBash.get(event.toolCallId);
    pendingSandboxedBash.delete(event.toolCallId);
    if (!original) return;
    let currentResult = {
      content: event.content,
      details: event.details,
      isError: true
    };
    let executionStartedAt = original.startedAt;
    for (let attempt = 0; attempt < MAX_SANDBOX_PERMISSION_RETRIES; attempt++) {
      const violations = await getFilesystemViolationsForFailedBashResult(
        original.command,
        currentResult.content,
        executionStartedAt
      );
      if (violations === null || violations.length === 0) {
        return attempt === 0 ? void 0 : currentResult;
      }
      const granted = [];
      for (const violation of violations) {
        const decision = await allowSandboxFilesystemViolation(violation, currentResult, ctx);
        if (!decision.allowed) return decision.result;
        granted.push(decision.granted);
      }
      notifySandboxRetry(ctx, granted);
      executionStartedAt = Date.now();
      currentResult = await retrySandboxedBash(event.toolCallId, original, ctx);
      if (!currentResult.isError) return currentResult;
    }
    return appendSandboxErrorResult(
      currentResult,
      `Sandbox: permission retry limit (${MAX_SANDBOX_PERMISSION_RETRIES}) reached for bash command.`
    );
  });
  pi.on("session_start", async (_event, ctx) => {
    lastStatusContext = ctx;
    ensureBashToolRegistered(pi, ctx.cwd);
    const result = await enableSandbox(ctx);
    if (result.accepted) return;
    const type = result.reason?.startsWith("Sandbox initialization failed") ? "error" : result.reason?.includes("config") ? "info" : "warning";
    ctx.ui.notify(result.reason ?? "Sandbox disabled", type);
  });
  pi.on("session_shutdown", async () => {
    releaseBashToolOwner(pi);
    pendingSandboxedBash.clear();
    clearReadOnlyWriteLocks();
    stopDirectMacSandboxMonitoring();
    if (sandboxInitialized) {
      try {
        await runWithWriteLockBypass(() => SandboxManager.reset());
      } catch {
      }
    }
    sandboxEnabled = false;
    sandboxInitialized = false;
    lastStatusContext = void 0;
  });
  pi.registerCommand("sandbox-enable", {
    description: "Enable the sandbox for this session",
    handler: async (_args, ctx) => {
      if (sandboxEnabled && sandboxInitialized) {
        ctx.ui.notify("Sandbox is already enabled", "info");
        return;
      }
      const result = await enableSandbox(ctx, { overrideConfig: true });
      if (result.accepted) {
        ctx.ui.notify("Sandbox enabled", "info");
      } else {
        const type = result.reason?.startsWith("Sandbox initialization failed") ? "error" : "warning";
        ctx.ui.notify(result.reason ?? "Sandbox could not be enabled", type);
      }
    }
  });
  pi.registerCommand("sandbox-disable", {
    description: "Disable the sandbox for this session",
    handler: async (_args, ctx) => {
      if (!sandboxEnabled) {
        await disableSandbox(ctx, { overrideConfig: true });
        ctx.ui.notify("Sandbox is already disabled", "info");
        return;
      }
      await disableSandbox(ctx, { overrideConfig: true });
      ctx.ui.notify("Sandbox disabled", "info");
    }
  });
  pi.registerCommand("sandbox", {
    description: "Show sandbox configuration",
    handler: async (_args, ctx) => {
      if (!sandboxEnabled) {
        ctx.ui.notify("Sandbox is disabled", "info");
        return;
      }
      const config2 = loadConfig(ctx.cwd);
      const { globalPath, projectPath } = getConfigPaths(ctx.cwd);
      const lines = [
        "Sandbox Configuration",
        `  Project config: ${projectPath}`,
        `  Global config:  ${globalPath}`,
        "",
        "Network (bash + !cmd):",
        `  Allowed domains: ${config2.network?.allowedDomains?.join(", ") || "(none)"}`,
        `  Denied domains:  ${config2.network?.deniedDomains?.join(", ") || "(none)"}`,
        ...sessionAllowedDomains.length > 0 ? [`  Session allowed: ${sessionAllowedDomains.join(", ")}`] : [],
        "",
        "Filesystem (bash + direct filesystem tools):",
        `  Read-only locks: ${describeReadOnlyWriteLocks()}`,
        `  Deny Read:   ${config2.filesystem?.denyRead?.join(", ") || "(none)"}`,
        `  Allow Read:  ${config2.filesystem?.allowRead?.join(", ") || "(none)"}`,
        `  Allow Write: ${config2.filesystem?.allowWrite?.join(", ") || "(none)"}`,
        `  Deny Write:  ${config2.filesystem?.denyWrite?.join(", ") || "(none)"}`,
        ...sessionAllowedReadPaths.length > 0 ? [`  Session read files/dirs:  ${sessionAllowedReadPaths.join(", ")}`] : [],
        ...sessionAllowedWritePaths.length > 0 ? [`  Session write files/dirs: ${sessionAllowedWritePaths.join(", ")}`] : [],
        "",
        "Note: If Allow Read is empty, reads are only prompted when matching Deny Read.",
        "Note: If Allow Read has entries, reads are prompted unless the path matches Allow Read.",
        "Note: denyRead prompts can be overridden by granting read access.",
        "Note: session filesystem grants may apply to a single file or its containing folder.",
        "Note: denyWrite takes PRECEDENCE over allowWrite and is never prompted."
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    }
  });
}
export {
  index_default as default,
  getReadBlockReason,
  shouldPromptForWrite
};
