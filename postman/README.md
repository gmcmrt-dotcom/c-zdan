# Postman / Bruno / Insomnia collections

The collection in this directory is for **shaping the public merchant API
calls during development**. It MUST NOT be shipped with filled-in
credentials.

## Hard rules before exporting

1. Replace every variable value (api key, signing secret, JWT, etc.) with
   `{{varName}}` and ship only the variable names. Postman by default
   includes the **current value** in the export — set them to "Reset" or
   strip the file before committing / sharing.
2. Re-check the exported JSON for any leftover `value:` fields that
   contain anything but a placeholder. `git diff` is your friend.
3. Never push a Postman *environment* file. Environments hold the
   resolved values; collections themselves should be value-free.
4. The `Wallet-Commerce-Merchant.postman_collection.json` shipped here
   is the canonical reference shape. Open it in Postman, set your local
   variables, but DON'T overwrite the file with the populated version.

## Why this matters

The merchant API is HMAC-signed; an exported collection with a real
`signing_secret` is equivalent to leaking the merchant's API credentials.
It also includes the historical leaked-token finding documented in
P0-29 (installer logs printing the admin password) — same threat shape.

See also `docs/HARD_RULES.md` for the full credential-handling policy.
