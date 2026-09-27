// Why the add/reconnect controls are missing on a device that isn't allowed
// to run an account connect flow. The server decides that per request (see
// server/src/services/trustedNetworks.js) and reports it in the /accounts
// payload, rather than this app inferring it from its own hostname the way it
// used to: being allowed is a property of the network the request came in on,
// which a page loaded at localhost can be forwarded from and a page loaded at
// the Pi's own address can still be refused from.
//
// Shared by the Google and Microsoft sections and the Microsoft reconnect
// banner so all three say the same thing. `what` is the action in that
// section's own words; `inline` drops the paragraph styling for the one place
// this goes inside a warning banner instead of standing on its own.
export default function AddAccountNote({ what, clientAddress, inline = false }) {
  const Tag = inline ? 'span' : 'p';
  return (
    <Tag className={inline ? undefined : 'add-account-note'}>
      {what} works from the Pi's own screen — open <code>http://localhost:3000/companion</code> there — or from a
      network listed in <code>TRUSTED_CIDRS</code> in <code>server/.env</code>
      {clientAddress ? (
        <>
          {' '}
          (this device is <code>{clientAddress}</code>)
        </>
      ) : null}
      .
    </Tag>
  );
}
