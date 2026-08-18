> **Learning goal**
> Design an authentication system, and be able to explain session tokens vs. JWTs, how passwords should be stored safely, and how multi-factor authentication and OAuth-style third-party login fit into the overall flow.

## 10.1 Requirements and scope

**Functional requirements**

- A user can register with an email/username and password.
- A user can log in with credentials and receive proof of authentication usable on subsequent requests.
- A user can log out, invalidating that proof.
- Support optional multi-factor authentication (MFA) and optional login via a third-party identity provider (OAuth-style "Sign in with X").

**Non-functional requirements**

- **Security is the primary requirement, above raw performance**: this system holds the keys to every other system a user can access, so correctness and safety of the auth flow matter more than shaving milliseconds off latency, though latency still matters for user experience.
- **High availability**: if authentication is down, users can't use the product at all — it's a hard dependency for essentially everything else, so this needs to be one of the most available components in the whole system.
- **Statelessness where possible, for scalability**: the design should avoid forcing every request through a single stateful bottleneck to check "is this user logged in," since authentication checks happen on nearly every request across the whole product.
- **Resistance to common attacks**: password database breaches, credential stuffing, session hijacking, and brute-force login attempts should all be meaningfully mitigated by design, not bolted on as an afterthought.

**Out of scope**: full authorization/permissions modeling (role-based access control, fine-grained resource permissions) — this lesson covers proving *who* a user is, not what they're allowed to do once identified. Also out of scope: the detailed cryptography inside a specific MFA algorithm (TOTP's math) beyond the conceptual flow.

## 10.2 Scale estimation

- **User base**: assume 50 million registered users, with 5 million daily active users logging in an average of twice a day → **10 million login events/day** ≈ **~115 logins/sec** average, with predictable peaks (e.g., morning login rush) pushing this a few times higher.
- **Authenticated requests**: far more common than logins themselves — every authenticated API call needs its token/session validated. Assume each active user makes 50 authenticated requests/day → 5,000,000 × 50 = 250 million validations/day ≈ **~2,900 validations/sec average**, with peak likely 3x that, around **~8,700/sec** — this is the number that really drives the token-validation design, since it dwarfs the login rate by roughly 25x.
- **Storage**: a user credentials table with 50 million rows, each perhaps 200 bytes (id, email, password hash, salt, metadata) is only **~10 GB** — small; this is not a storage-volume problem.
- **Failed-login/brute-force traffic**: worth explicitly estimating as a hostile input, not just legitimate traffic — a credential-stuffing attack could attempt thousands of login requests/sec against the system, meaning the login endpoint specifically (not just the validation endpoint) needs rate limiting sized for adversarial load, not just organic peak load.

The takeaway: token/session *validation* volume (tens of thousands/sec at peak) is the real throughput number this system must be built for, not the login rate itself — which is exactly why the choice between session tokens and JWTs (10.5) matters so much: it determines whether every one of those validations needs a database round trip or not.

## 10.3 API and data model

**API**

| Method & Path | Request | Response |
| --- | --- | --- |
| `POST /api/auth/register` | `{ "email": "...", "password": "..." }` | `201 Created` |
| `POST /api/auth/login` | `{ "email": "...", "password": "...", "mfaCode": "optional" }` | `{ "accessToken": "...", "refreshToken": "..." }` |
| `POST /api/auth/refresh` | `{ "refreshToken": "..." }` | `{ "accessToken": "..." }` |
| `POST /api/auth/logout` | `{ "refreshToken": "..." }` | `204 No Content` (invalidates the refresh token) |
| `GET /api/auth/oauth/{provider}/callback` | (query params from provider) | Redirect with session established |

**Data model**

Core entities: `User { id, email, passwordHash, salt, mfaEnabled, mfaSecret (encrypted) }` and `RefreshToken { id, userId, tokenHash, expiresAt, revoked }`.

This data has real relational structure worth naming explicitly: a user has many refresh tokens (one per device/session), lookups need to be strongly consistent (a revoked token must never be treated as valid — a stale read here is a real security bug, not a minor inconvenience), and the data volume is modest (10.2). All three of these point toward a relational database rather than a NoSQL store: the requirement for strong, immediate consistency on security-sensitive state (has this token been revoked?) is a much better match for a system with strong consistency guarantees by default, and the data volume here is nowhere near large enough to need NoSQL's horizontal scaling advantages. This is a useful contrast with the URL shortener and key-value store lessons — the deciding factor isn't "reads vs. writes" or raw scale, it's that *correctness of security state* has a much lower tolerance for staleness than almost anything else in this course.

## 10.4 High-level architecture

```text
Client
  -> Load Balancer
       -> Auth Service
            -> User/Credentials DB (registration, login, password verification)
            -> Token Issuer (issues access + refresh tokens on successful login)

Other Services (across the product)
  -> Token Validation (stateless, via JWT signature check — no DB call, see 10.5)
       -> (only for revocation checks / refresh) -> Auth Service -> RefreshToken DB
```

**Login path**: the client submits credentials to the Auth Service, which looks up the user, verifies the password against the stored hash (10.5), checks MFA if enabled, and on success issues a short-lived access token and a longer-lived refresh token, storing a record of the refresh token so it can later be revoked.

**Authenticated-request path (the high-volume path)**: for every subsequent request to any service in the product, the client presents its access token. Because this happens ~8,700 times/sec at peak (10.2), the design deliberately avoids a database call on this path wherever possible — each service independently verifies the token's cryptographic signature and expiration locally (this is the core reason JWTs are attractive, detailed in 10.5), only falling back to the Auth Service when the access token has expired and a new one must be issued via the refresh token.

## 10.5 Deep dive: session tokens vs. JWTs, password storage, and MFA/OAuth

**Session tokens vs. JWTs.** Both solve the same problem — proving on a later request that a user already authenticated — but with an opposite trade-off around where the "truth" lives.

- **Opaque session tokens**: the server generates a random token, stores a mapping `token -> userId, expiry` in a database (or a fast shared store like Redis), and gives the token to the client. Every subsequent request requires looking up that token server-side to validate it. This makes revocation trivial and instant (just delete the row), because the server is always consulted, but it means every one of those ~8,700 validations/sec at peak needs a lookup against shared state — which becomes the thing that must scale.
- **JWTs (JSON Web Tokens)**: the server encodes the user's identity and claims (user ID, roles, expiry) directly into a token and cryptographically signs it. Any service holding the public key (or shared secret, for symmetric signing) can verify the signature and trust the contents *without* a database call — the token carries its own proof. This is what makes JWTs attractive at scale: it turns a would-be database-bound validation step into a local, stateless CPU operation, which is exactly the property needed given how dominant the validation request rate is compared to the login rate in this system.

The real trade-off is **revocation**. A session token can be invalidated instantly by deleting its server-side record. A JWT, once issued, is self-contained and valid until it expires — there's no central place to "delete" it, since any service with the public key can independently verify it without ever checking back in. If a JWT is stolen, it remains usable until it naturally expires.

| Approach | Validation cost | Revocation | Best fit |
| --- | --- | --- | --- |
| Opaque session token | DB/cache lookup per request | Instant | Systems needing immediate revocation, or lower request volume |
| JWT | Local signature check, no DB call | Delayed (until expiry), unless extra machinery added | High-volume systems, especially across many independent services |

The common resolution — and the one this design uses — is a **hybrid**: issue short-lived JWT access tokens (e.g., 15 minutes) for the high-volume request-validation path, so most validations are fully stateless, but pair them with a longer-lived opaque refresh token that *is* tracked server-side and checked against the database. This bounds the "stolen token still works" window to at most 15 minutes for access tokens (acceptable risk for most products), while keeping the ability to fully revoke a user's access (e.g., "log out everywhere," or a detected account compromise) by revoking their refresh token, which prevents any new access token from being issued going forward. This is exactly why the architecture in 10.4 only calls back to the Auth Service on refresh, not on every request.

**Password storage.** Passwords must never be stored in plaintext or with reversible encryption — the standard is a one-way, deliberately slow **hashing algorithm designed for passwords** (bcrypt, scrypt, or Argon2 — not a fast general-purpose hash like SHA-256 or MD5, which are actually a liability here because their speed is exactly what makes brute-forcing feasible at scale). Each password is combined with a unique, randomly generated **salt** before hashing, and the salt is stored alongside the hash (it doesn't need to be secret). Salting matters for two reasons: it means two users with the same password get different stored hashes (defeating precomputed "rainbow table" attacks), and it means an attacker who breaches the database must brute-force each password individually rather than cracking one hash and matching it against every user at once. On login, the submitted password is hashed with the stored salt and compared to the stored hash — the plaintext password itself is never stored or logged anywhere, ever.

**MFA and OAuth, at a high level.** Multi-factor authentication adds a second, independent proof of identity beyond the password — typically a time-based one-time code (TOTP) generated from a secret shared between the server and the user's authenticator app at enrollment time, or a push notification to a trusted device. The key property is independence: the second factor should not be derivable from the first (knowing the password shouldn't help guess the TOTP code), so that compromising one factor alone (e.g., a leaked password from a breach) isn't sufficient to log in.

OAuth-style third-party login ("Sign in with Google") delegates identity verification to an external provider instead of managing a password for that user at all. At a high level: the client is redirected to the provider, the user authenticates there (the provider handles password/MFA entirely), and the provider redirects back to the auth system with a short-lived authorization code. The auth system exchanges that code (server-to-server, using a pre-shared secret with the provider) for the user's verified identity, then issues its own access/refresh tokens exactly as in the normal login path. The important detail is that the raw authorization code is never trusted on its own on the client side — the server-to-server exchange step is what prevents a client from forging a fake "I logged in with Google" claim.

## 10.6 Bottlenecks and trade-offs

- **Single points of failure**: the User/Credentials database is a SPOF for login (though not for already-issued access tokens, since JWT validation doesn't need it) — mitigated with standard database replication and failover. The Auth Service itself should be run as multiple stateless replicas behind the load balancer.
- **Hot spots**: not typically a per-key hot spot problem like a cache or key-value store — the more relevant "hot spot" risk here is adversarial: a credential-stuffing attack concentrating huge request volume on the login endpoint specifically. This is mitigated with aggressive rate limiting per IP/account on login (and MFA challenges triggered by suspicious patterns), separate from general request throttling elsewhere in the product.
- **Consistency vs. availability**: this system deliberately favors strong consistency for security-critical state (has this refresh token been revoked, has this account been locked) even at some availability/latency cost, while favoring statelessness and availability for the high-volume access-token validation path via JWTs — a good example of a single system making *different* consistency choices for different parts of its data, rather than one blanket policy.
- **What breaks first at 10x/100x scale**: at 10x validation volume, the JWT-based stateless path scales linearly since it's just CPU-bound signature verification replicated across more service instances — this is exactly why it was chosen over a pure session-token design given the ~25x gap between login and validation rates. At 100x, the credentials database (still needed for login and refresh-token revocation checks) becomes the constraint, typically addressed with read replicas for login lookups and careful indexing on the refresh token table, since that table is checked far more often (every refresh) than the credentials table (only at login).

## 10.7 Summary

Authentication design centers on a genuine trade-off between validation cost and revocation speed, resolved here with a hybrid of short-lived, stateless JWT access tokens (for the high-volume request-validation path) and longer-lived, server-tracked opaque refresh tokens (for revocability). Password storage relies on slow, salted, purpose-built hashing algorithms (never fast general-purpose hashes, never plaintext), and both MFA and OAuth extend the core login flow with an independent, delegated, or additional proof of identity without changing how the rest of the system consumes the resulting tokens.

Natural follow-ups: adding fine-grained authorization/permissions on top of this authentication layer (a genuinely separate concern from "who is this user"), and handling token compromise detection (e.g., refresh token reuse detection, where a refresh token being used twice after rotation signals a likely theft and triggers revoking the entire token family).
