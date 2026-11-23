# Deploying EthioFoodCast

Two pieces, two free hosts:

| Piece | Host | Why |
|---|---|---|
| API (`backend/`, FastAPI and the model) | Hugging Face Spaces (Docker) | Free CPU machine with enough memory for the model files |
| Website (`frontend/`, Next.js) | Vercel | Built for Next.js; static pages load instantly worldwide |

The website calls the API from the visitor's browser (scoring) and from its own
server (the interview questions and the knowledge centre's answers). Groq is called only from
the website's server, so it works for every visitor wherever they are.

Deploy the API first: the website needs its address.

## 1. API on Hugging Face Spaces

1. Create a free account at huggingface.co.
2. **New Space** → name it (for example `ethiofoodcast-api`) → SDK **Docker** →
   template **Blank** → hardware **CPU basic (free)** → **Public** → Create.
3. **Settings → Access Tokens** (your profile, not the Space) → create a token with
   **Write** permission. Keep it private.
4. Install Git LFS once: https://git-lfs.com, then run `git lfs install`.
5. From the repository root, in Git Bash:

   ```bash
   DRY_RUN=1 scripts/publish_hf_space.sh <your-username>/ethiofoodcast-api   # check first
   scripts/publish_hf_space.sh <your-username>/ethiofoodcast-api
   ```

   When git asks, the username is your Hugging Face username and the password is
   the token from step 3.
6. In the Space, **Settings → Variables and secrets → New variable**:
   `ALLOWED_ORIGINS` = your website address from step 2 below (for example
   `https://ethiofoodcast.vercel.app`). Until you have it, leave it unset; only
   local addresses are allowed.
7. Wait for the build (about 5 minutes the first time). The API is at
   `https://<your-username>-ethiofoodcast-api.hf.space`; check
   `https://<your-username>-ethiofoodcast-api.hf.space/api/health`.

Run the publish command again whenever `backend/` changes. A free Space sleeps
after a long period without visits; the first visit after that takes a minute or
two while it starts.

## 2. Website on Vercel

1. Create a free account at vercel.com and sign in with GitHub.
2. **Add New → Project** → import the EthioFoodCast repository.
3. **Root Directory**: `frontend`. Framework: Next.js (detected). Keep
   **Include files outside the root directory in the Build Step** enabled: the
   build reads `backend/artifacts` and `docs/`.
4. **Environment Variables**:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<your-username>-ethiofoodcast-api.hf.space` |
   | `GROQ_API_KEY` | your Groq key (never prefix it with `NEXT_PUBLIC_`) |
   | `GROQ_MODEL` | the Groq model name you use locally |
| `ASK_RATE_LIMIT` | optional: questions per minute per visitor (default 6) |

5. **Deploy.** Every push to `main` redeploys automatically.
6. Copy the website address and set it as `ALLOWED_ORIGINS` on the Space
   (step 1.6). The Space restarts with the new setting.

## 3. Check it

- The overview, Plan and Insights pages load without the API.
- **Assess → One household**: complete an interview and score it.
- **About → Knowledge centre**: ask one of the example questions; the answer should cite its sources.

## API settings

| Variable | Default | Meaning |
|---|---|---|
| `ALLOWED_ORIGINS` | local addresses | Comma-separated websites allowed to call the API from a browser; `*` allows any |
| `RATE_LIMIT_PREDICT` | `60` | Scorings per minute per visitor; `0` turns the limit off |
| `RATE_LIMIT_BATCH` | `10` | Batch uploads per minute per visitor |
| `MAX_BATCH_ROWS` | `2000` | Households accepted in one batch upload |
| `PORT` | `5000` | Set automatically by hosts that need it |

## Other hosts

The API image runs anywhere Docker does (`docker build -f backend/Dockerfile .`,
build context = repository root) and honours `$PORT`, so Render, Railway or
Fly.io work too; use about 1 GB of memory. The website also runs from
`frontend/Dockerfile` (see `docker-compose.yml`).
