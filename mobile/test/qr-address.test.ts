import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScannedAddress } from '../src/services/qr-address.ts';

/**
 * A scanned code is the only place a recipient arrives from outside the user's own typing, so
 * these cases are mostly about what must be refused. The one that matters most is the
 * token-transfer form, where the address in the obvious position is a contract and sending to
 * it burns the funds.
 */

const ADDR = '0x1111111111111111111111111111111111111111';
const USDT = '0xE5b6C29411b3ad31C3613BbA0145293fC9957256';

test('a bare address is accepted, which is what our own receive code contains', () => {
  assert.deepEqual(parseScannedAddress(ADDR), { ok: true, address: ADDR, chain: null, hadAmount: false });
  // Whitespace from a scan, and a checksummed address, both fine.
  assert.equal(parseScannedAddress(`  ${USDT}  `).ok, true);
  assert.equal((parseScannedAddress(USDT) as { address: string }).address, USDT, 'casing is preserved for the checksum');
});

test('EIP-681 is accepted, with and without a chain', () => {
  assert.deepEqual(parseScannedAddress(`ethereum:${ADDR}`), { ok: true, address: ADDR, chain: null, hadAmount: false });
  assert.deepEqual(parseScannedAddress(`ethereum:${ADDR}@421614`), { ok: true, address: ADDR, chain: 'arbitrum', hadAmount: false });
  assert.deepEqual(parseScannedAddress(`ethereum:${ADDR}@11155111`), { ok: true, address: ADDR, chain: 'ethereum', hadAmount: false });
  // The pay- prefix and an uppercase scheme are both legal.
  assert.equal((parseScannedAddress(`ethereum:pay-${ADDR}@421614`) as { chain: string }).chain, 'arbitrum');
  assert.equal(parseScannedAddress(`ETHEREUM:${ADDR}`).ok, true);
});

test('an amount in the code is reported and never returned as a value to use', () => {
  const scanned = parseScannedAddress(`ethereum:${ADDR}@421614?value=2.5e18`);
  assert.equal(scanned.ok, true);
  assert.equal(scanned.ok === true ? scanned.hadAmount : false, true);
  // There is no amount field at all. Code and the user pick every number — a QR can be stale
  // or printed by somebody else, and people confirm prefilled fields.
  assert.deepEqual(Object.keys(scanned).sort(), ['address', 'chain', 'hadAmount', 'ok']);

  // No amount in the code reports false rather than undefined.
  assert.equal((parseScannedAddress(`ethereum:${ADDR}?label=Bob`) as { hadAmount: boolean }).hadAmount, false);
});

test('a token-transfer code is refused, because its target is a contract', () => {
  // ethereum:<token>/transfer?address=<recipient> puts the TOKEN where the address normally
  // goes. Reading the target as the recipient would send to a token contract, which is an
  // unrecoverable burn. The recipient is in a parameter, and guessing at that is worse.
  const transfer = parseScannedAddress(`ethereum:${USDT}/transfer?address=${ADDR}&uint256=1e6`);
  assert.equal(transfer.ok, false);
  assert.match(transfer.ok === false ? transfer.reason : '', /token transfer/i);
  // Crucially, the token address must not come back as a recipient under any key.
  assert.equal(JSON.stringify(transfer).includes(USDT), false, 'the contract address must not be returned at all');

  // Any function call, not only transfer.
  assert.equal(parseScannedAddress(`ethereum:${USDT}/approve?address=${ADDR}`).ok, false);
});

test('an unsupported or malformed network is refused rather than guessed', () => {
  const mainnet = parseScannedAddress(`ethereum:${ADDR}@1`);
  assert.equal(mainnet.ok, false);
  assert.match(mainnet.ok === false ? mainnet.reason : '', /network 1/);

  // Hex chain ids are legal EIP-681 but accepting them means guessing at the value that decides
  // which network money goes to.
  assert.equal(parseScannedAddress(`ethereum:${ADDR}@0x66eee`).ok, false);
  assert.equal(parseScannedAddress(`ethereum:${ADDR}@`).ok, false);
  assert.equal(parseScannedAddress(`ethereum:${ADDR}@99999999999999`).ok, false);
});

test('everything else is refused, and an address is never dug out of arbitrary text', () => {
  for (const bad of [
    '',
    '   ',
    'hello',
    `Pay me at ${ADDR} please`,     // an address inside prose: a poster could carry this
    `bitcoin:${ADDR}`,
    `ethereum:${ADDR.slice(0, 41)}`, // one character short
    `ethereum:${ADDR}2`,             // one too long
    `ethereum:vitalik.eth`,          // no name resolution in this app
    `ethereum:`,
    '0x',
  ]) {
    assert.equal(parseScannedAddress(bad).ok, false, `must refuse: ${JSON.stringify(bad)}`);
  }

  // The zero address passes the shape test and can never receive funds.
  assert.match(
    (parseScannedAddress(`0x${'0'.repeat(40)}`) as { reason: string }).reason,
    /zero address/,
  );
  assert.equal(parseScannedAddress(`ethereum:0x${'0'.repeat(40)}@421614`).ok, false);

  // Non-strings cannot crash it.
  for (const bad of [undefined, null, 42, {}, []]) {
    assert.equal(parseScannedAddress(bad).ok, false, `must refuse: ${String(bad)}`);
  }
});

test('no refusal message leaks the scanned payload back onto the screen', () => {
  // A refusal is shown next to a camera. Echoing arbitrary scanned text into the UI is how a
  // QR code gets to put words of its choosing in front of a user.
  const payload = 'ethereum:DROP TABLE wallets; <script>alert(1)</script>';
  const result = parseScannedAddress(payload);
  assert.equal(result.ok, false);
  const reason = result.ok === false ? result.reason : '';
  assert.doesNotMatch(reason, /script|DROP TABLE/i);
  // A chain id is the one scanned value echoed, and only after passing \d{1,10}.
  assert.match((parseScannedAddress(`ethereum:${ADDR}@777`) as { reason: string }).reason, /network 777/);
});
