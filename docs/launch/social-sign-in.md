# "Continue with Google" and "Continue with Apple": setup

Written 6 October 2026. The code is done; this is everything that has to be
set up **outside** the code. Nothing here goes into the repository.

## How it works (one paragraph)

FYStay's logins are run by **Auth.js** (the `next-auth` library) and stored
in FYStay's own `User` table. Supabase only provides the database and photo
storage, **not** logins. So Google and Apple are added to Auth.js, next to
email and password, and share the same session, header menu, sign-out and
"sign out everywhere". **Nothing needs configuring in Supabase Auth**: don't
switch on its Google or Apple providers, they wouldn't be used.

Each Google or Apple account is remembered by its own permanent id (table
`AuthIdentity`), not by email. If someone already has a FYStay **password**
account with the same email, Google or Apple won't take it over: they're
asked to log in with their password and connect Google or Apple from
**Account → Sign-in methods** (which asks for the password again).

## Order of work

1. **Database first.** Run the "Production database migration" workflow
   (`docs/production-database-migrations.md`) for the commit that adds
   `20261006220000_add_auth_identities`, **before** deploying this code to
   Production. The account page reads the new table, so it would fail
   without it.
2. Deploy the code (fresh Production build).
3. Google and Apple setup below, in any order. Each button appears on its
   own once its variables are set and the site is rebuilt.

## Addresses used below

| | Address |
|---|---|
| Production site | `https://fystay.vercel.app` (the live address today; when the custom domain goes live, **add** its addresses alongside these, then remove the old ones once nothing uses them) |
| Local development | `http://localhost:3000` |
| Google callback | `<site>/api/auth/callback/google` |
| Apple callback | `<site>/api/auth/callback/apple` |

## Public vs secret values

| Value | Public or secret | Where it goes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Public (it appears in the sign-in link) | Vercel variable |
| `GOOGLE_CLIENT_SECRET` | **SECRET** | Vercel variable, marked Sensitive |
| `APPLE_CLIENT_ID` (the Services ID) | Public | Vercel variable |
| `APPLE_TEAM_ID` | Public | Vercel variable |
| `APPLE_KEY_ID` | Public | Vercel variable |
| `APPLE_PRIVATE_KEY` (the `.p8` file) | **SECRET** | Vercel variable, marked Sensitive |

None of these is `NEXT_PUBLIC_`, so none ever reaches a browser. Never put
any of them in the code, in chat, or in a screenshot. Apple's "client
secret" is made by the app itself from the private key each time it starts,
so there's no six-monthly renewal to remember.

Vercel: project → Settings → Environment Variables. Add to **Production**;
add to **Preview** too if you'll test there (Preview can use the same
Google/Apple apps, see the testing section). Rebuild after adding.

## Google (Google Cloud Console, console.cloud.google.com)

1. **Project:** top bar → New project → name "FYStay".
2. **OAuth consent screen** (APIs & Services → OAuth consent screen, called
   "Google Auth Platform → Branding" in newer consoles):
   - User type **External**.
   - App name **FYStay**, user support email (an inbox you read), logo
     (optional, triggers Google's brand review).
   - App domain: home page `https://fystay.vercel.app`, privacy policy
     `https://fystay.vercel.app/legal/privacy`, terms
     `https://fystay.vercel.app/legal/terms`.
   - Authorized domains: `fystay.vercel.app` (and your own domain later).
     Google may ask you to prove you own the domain in Google Search
     Console; with a custom domain that's a DNS record.
   - Scopes: only the three defaults, `openid`, `email`, `profile`. These
     are non-sensitive, so no security review is needed.
   - **Publishing status:** while "Testing", only the test users you list
     can sign in. Press **Publish app** to make it "In production" before
     launch.
3. **OAuth client** (APIs & Services → Credentials → Create credentials →
   OAuth client ID):
   - Application type **Web application**, name "FYStay web".
   - **Authorized JavaScript origins:** `https://fystay.vercel.app`,
     `http://localhost:3000`.
   - **Authorized redirect URIs:** `https://fystay.vercel.app/api/auth/callback/google`,
     `http://localhost:3000/api/auth/callback/google`.
     Add the Preview branch address too if you'll test there (Google
     doesn't accept wildcards).
4. Google then shows the **Client ID** (ends `.apps.googleusercontent.com`)
   → `GOOGLE_CLIENT_ID`, and the **Client secret** (starts `GOCSPX-`)
   → `GOOGLE_CLIENT_SECRET`. You can see the secret again under
   Credentials → the client.
5. If `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` exist in Vercel from earlier
   notes, delete them: they're no longer used.

## Apple (developer.apple.com → Certificates, Identifiers & Profiles)

Needs a paid Apple Developer Program membership (organisation membership
shows "FYStay" on Apple's screen; an individual one shows your name).

1. **Team ID:** top right of the developer site, or Membership details.
   10 characters → `APPLE_TEAM_ID`.
2. **App ID** (Identifiers → + → App IDs → App): description "FYStay",
   Bundle ID e.g. `uk.co.fystay.app` (explicit), tick **Sign in with
   Apple** → Save. (Apple requires one, even for a website only.)
3. **Services ID** (Identifiers → + → Services IDs): description "FYStay"
   (this is the name people see on Apple's sign-in sheet), identifier e.g.
   `uk.co.fystay.web` → `APPLE_CLIENT_ID`. Then open it, tick **Sign in
   with Apple** → Configure:
   - Primary App ID: the App ID from step 2.
   - **Domains and Subdomains:** `fystay.vercel.app` (no `https://`).
   - **Return URLs:** `https://fystay.vercel.app/api/auth/callback/apple`.
   - Apple **does not allow `localhost` or plain `http`**; see testing below.
   - Save, then Continue, then Save again.
4. **Key** (Keys → +): name "FYStay Sign in with Apple", tick **Sign in
   with Apple** → Configure → choose the App ID → Save → Continue →
   Register. Note the **Key ID** (10 characters) → `APPLE_KEY_ID`.
   **Download** the `.p8` file: Apple lets you download it **once only**.
   Open it in a text editor and paste the whole contents, including the
   `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines, into
   `APPLE_PRIVATE_KEY` (Sensitive). Then store the file somewhere safe
   (a password manager), not in the repository or email.
5. **Emails to "Hide My Email" addresses.** People may choose Apple's
   private relay (`…@privaterelay.appleid.com`). Apple only forwards mail
   to those addresses from senders you register: Certificates, Identifiers
   & Profiles → **Services → Sign in with Apple for Email Communication**
   → Configure → add your sending domain (the one verified in Resend,
   e.g. `fystay.co.uk`) and the `EMAIL_FROM` address. The domain needs SPF
   (Resend's setup already adds it). Without this, booking confirmations
   to those guests are silently dropped.

## Testing

### Google, locally

1. In a file named `.env.local` (git ignores it) on your own computer, set
   `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, plus the usual local
   database settings.
2. `npm run dev`, open `http://localhost:3000/login`.
3. "Continue with Google" → choose an account → you're back on FYStay,
   logged in, with your name in the header menu.
4. Log out, log in again with Google: same account (check Account →
   Sign-in methods shows Google connected).
5. Press "Continue with Google", then cancel on Google's screen: you see
   "Google sign-in was cancelled. Please try again."

### Apple, locally

Apple won't send people back to `localhost`, so use a temporary https
address for your computer:

1. Install Cloudflare's free `cloudflared`, run
   `cloudflared tunnel --url http://localhost:3000`, and note the
   `https://….trycloudflare.com` address it prints.
2. Add that host to the Services ID's **Domains** and
   `https://….trycloudflare.com/api/auth/callback/apple` to its **Return
   URLs** (step 3 above). Apple can take a few minutes to accept changes.
3. In `.env.local` set the four `APPLE_` variables and
   `NEXTAUTH_URL=https://….trycloudflare.com`, then `npm run dev` and open
   the tunnel address (not localhost).
4. Remove the tunnel addresses from Apple afterwards.

Simpler alternative: test Apple on the **Preview** deployment, by adding the
Preview branch domain and its callback to the Services ID the same way.

### Both, on the live site (after the setup and a fresh build)

Use real accounts you control. Tick each off:

- [ ] New person, Google: account created with their Google name (and
      photo on the profile), lands back where they started (e.g. a listing
      they were booking).
- [ ] New person, Apple with **Hide My Email**: account created; Account
      page shows "Connected (email hidden by Apple)"; a test booking email
      arrives in the real inbox (proves step 5 above).
- [ ] Apple again with the same Apple ID: same account, not a new one.
- [ ] Existing email/password account, then "Continue with Google" with
      the same email: no new account; message says to log in with the
      password and connect Google from the account page.
- [ ] Log in with the password → Account → Sign-in methods → Connect
      Google → password → Google → back on Account with "Google is now
      connected". Log out; "Continue with Google" now logs in to it.
- [ ] Cancel on Google's and on Apple's screen: friendly "cancelled" message,
      buttons work again.
- [ ] Log out from the header menu, close and reopen the browser: still
      logged out. Log in with Google, close and reopen: still logged in.
- [ ] Disconnect Google from the account page (asks for the password).
- [ ] A suspended account (suspend a test user from /admin/users) can't get
      in with Google or Apple either.

## What the code does, for reference

- `src/auth.ts`: Google and Apple providers (switched on by the variables
  above), Apple's cross-site return handled with SameSite=None callback
  cookies on https, refused sign-ins sent back to `/login` with a reason.
- `src/lib/oauthAccounts.ts`: which account a Google/Apple sign-in belongs
  to (rules and reasons documented there), with tests.
- `src/lib/oauthLinkIntent.ts`, `src/app/api/account/connections`: connect
  and disconnect from the account page, password required, never removing
  the last way in.
- `src/lib/appleClientSecret.ts`: Apple's client secret, made from the key.
- `src/components/SocialSignInButtons.tsx`, `LoginForm`, `RegisterForm`,
  `SignInMethodsCard`: the buttons, "Signing you in…", and messages.
