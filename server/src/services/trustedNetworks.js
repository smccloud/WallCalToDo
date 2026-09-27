import net from 'net';
import { config } from '../config.js';

// Which remote addresses are allowed to run an account connect flow (the
// "Add Google account" / "Connect Microsoft account" buttons, and the
// Microsoft reconnect that grants Calendars.Read). The rest of the companion
// API trusts the home network the same way this file's sibling services trust
// it (see the README's "Companion app" section), but this one flow is the
// exception: it sends a browser to a provider's consent screen and then
// stores a long-lived token for whoever signed in, so it's limited to the
// Pi's own screen plus whatever networks server/.env's TRUSTED_CIDRS opts in
// -- e.g. a laptop you're adding an account from instead of walking over to
// the Pi.
//
// Deliberately the socket's own address rather than anything in a header:
// Express's `trust proxy` stays off and nothing reads X-Forwarded-For here,
// because a client can send that header itself, so honoring it would let
// anyone past the allowlist by claiming to be an allowed address. A port
// forwarder (ssh -L) is fine, though -- the connection still arrives from the
// forwarding machine's real address, which is the point of listing it.
const blockList = new net.BlockList();
const rejected = [];

// Loopback is in unconditionally, not something TRUSTED_CIDRS has to repeat:
// with no TRUSTED_CIDRS at all the intended default is "the Pi's own screen
// only", and that screen reaches the backend over 127.0.0.1 (or ::1) rather
// than the Pi's LAN address.
blockList.addSubnet('127.0.0.0', 8, 'ipv4');
blockList.addAddress('::1', 'ipv6');

const FAMILY = { 4: 'ipv4', 6: 'ipv6' };
const MAX_PREFIX = { 4: 32, 6: 128 };

// One TRUSTED_CIDRS entry: "192.168.1.0/24", a bare "192.168.1.42" (an
// implicit single host), "2001:db8::/32", or a single IPv6 host. Returns null
// once added, or a human-readable reason when it couldn't be -- a typo here
// would otherwise quietly lock you out of your own account connects with
// nothing but a button that doesn't work to explain it, so every unusable
// entry gets named in the log at startup.
function addEntry(entry) {
  const [address, prefix, ...extra] = entry.split('/');
  const family = net.isIP(address);
  if (!family) return `"${address || '(blank)'}" is not an IP address`;
  if (extra.length) return 'has more than one "/"';
  // Checked by hand rather than left to addSubnet, which throws on both of
  // these -- a malformed entry shouldn't be able to stop the server booting.
  if (prefix === undefined) {
    blockList.addAddress(address, FAMILY[family]);
    return null;
  }
  if (!/^\d{1,3}$/.test(prefix) || Number(prefix) > MAX_PREFIX[family]) {
    return `prefix "/${prefix}" isn't 0-${MAX_PREFIX[family]}`;
  }
  blockList.addSubnet(address, Number(prefix), FAMILY[family]);
  return null;
}

const entries = (config.trustedCidrs || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);
for (const entry of entries) {
  const problem = addEntry(entry);
  if (problem) rejected.push(`${entry} (${problem})`);
}

console.log(
  `[trustedNetworks] account connects allowed from 127.0.0.0/8, ::1` +
    (entries.length
      ? `, and TRUSTED_CIDRS: ${entries.join(', ')}`
      : ' — TRUSTED_CIDRS is unset, so remote computers are not allowed')
);
if (rejected.length) {
  console.warn(`[trustedNetworks] ignoring unusable TRUSTED_CIDRS entries: ${rejected.join('; ')}`);
}

// A dual-stack listener reports an IPv4 client as IPv4-mapped IPv6
// ("::ffff:192.168.1.42"), which matches none of the IPv4 entries above --
// unwrap it, or the ordinary LAN computer someone wrote 192.168.1.0/24 for
// would be the one thing that never matches.
export function clientAddress(req) {
  const address = req.socket?.remoteAddress;
  if (!address) return null;
  const mapped = address.slice(0, 7);
  return mapped === '::ffff:' && net.isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

export function isTrustedAddress(address) {
  const family = net.isIP(address);
  return family ? blockList.check(address, FAMILY[family]) : false;
}

export function isTrustedRequest(req) {
  const address = clientAddress(req);
  return address ? isTrustedAddress(address) : false;
}
