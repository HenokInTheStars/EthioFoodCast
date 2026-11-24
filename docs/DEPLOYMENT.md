# Deploying EthioFoodCast

Two pieces, two free hosts:

| Piece | Host | Why |
|---|---|---|
| API (`backend/`, FastAPI and the model) | Render (Docker, free web service) | Builds the existing Dockerfile from GitHub; 512 MB is enough (the API uses about 300 MB) |
| Website (`frontend/`, Next.js) | Vercel | Built for Next.js; static pages load instantly worldwide |

The website calls the API from the visitor's browser (scoring) and from its own
server (the interview questions and the knowledge centre's answers). Groq is called only from
the website's server, so it works for every visitor wherever they are.

Deploy the API first: the website needs its address.

## 1. API on Render

1. Create a free account at render.com and sign in with GitHub. No credit card is needed for
   the free plan.
2. **New → Blueprint** → connect the EthioFoodCast repository (give Render access to it if
   GitHub asks). Render reads [`render.yaml`](../render.yaml): one free Docker web service,
   `ethiofoodcast-api`, built from `backend/Dockerfile`.
3. When Render asks for `ALLOWED_ORIGINS`, leave it empty for now (only local addresses are
   allowed until it is set) and click **Apply**.
4. Wait for the first build (5 to 10 minutes). The API is at
   `https://ethiofoodcast-api.onrender.com` (Render shows the exact address if that name is
   taken); check `/api/health` on it.

Every push that changes `backend/`, `scripts/` or `render.yaml` redeploys automatically. A
free service sleeps after 15 minutes without visits; the first request after that takes
about a minute while it starts.
[`.github/workflows/keep-api-awake.yml`](../.github/workflows/keep-api-awake.yml) pings
`/api/health` every 10 minutes from 06:00 to 23:00 UTC to keep it awake; before a demo, run it
by hand from the repository's **Actions** tab. GitHub Actions minutes are free only for public
repositories.

Hugging Face Spaces also works if your account can create Docker Spaces:
`scripts/publish_hf_space.sh <user>/<space>` publishes the same image there.

## 2. Website on Vercel

1. Create a free account at vercel.com and sign in with GitHub.
2. **Add New → Project** → import the EthioFoodCast repository.
3. **Root Directory**: `frontend`. Framework: Next.js (detected). Keep
   **Include files outside the root directory in the Build Step** enabled: the
   build reads `backend/artifacts` and `docs/`.
4. **Environment Variables**:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | the API address from step 1, e.g. `https://ethiofoodcast-api.onrender.com` |
   | `GROQ_API_KEY` | your Groq key (never prefix it with `NEXT_PUBLIC_`) |
   | `GROQ_MODEL` | the Groq model name you use locally |
| `ASK_RATE_LIMIT` | optional: questions per minute per visitor (default 6) |

5. **Deploy.** Every push to `main` redeploys automatically.
6. Copy the website address and set it as `ALLOWED_ORIGINS` on the Render service
   (**Environment**). Render restarts it with the new setting.

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
