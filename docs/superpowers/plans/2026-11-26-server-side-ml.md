# Server-Side ML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move MobileNet feature extraction and classifier training to a Node server, while supporting both browser-side camera prediction and server-side camera prediction.

**Architecture:** Keep the current TensorFlow.js MobileNet V2 feature contract and Dense classifier. Add a Fastify API and isolated TensorFlow worker using `@tensorflow/tfjs-node`; persist one versioned classifier plus compatibility manifest. In browser inference, run local MobileNet plus downloaded Dense head; in server inference, send one resized JPEG frame at a time to the server.

**Tech Stack:** Node.js ESM, Fastify, `@fastify/multipart`, TensorFlow.js Node CPU backend, existing Vite/TensorFlow.js frontend, node:test, Playwright.

---

## File map

- Create `server/index.js`: Fastify setup, Vite static hosting integration in production, API route registration, startup/shutdown.
- Create `server/training-worker.js`: long-lived worker-thread entrypoint for TensorFlow.js Node model loading, embeddings, classifier training, save/load/inference.
- Create `server/job-store.js`: one-job lifecycle and progress state; no external database.
- Create `server/model-store.js`: atomic local-disk model version persistence and compatibility metadata.
- Create `server/routes.js`: upload, status, model artifact and frame prediction endpoints with validation.
- Create `server/image-input.js`: strict image input validation and canonical decode/resize/RGB transformation, used by the Node worker.
- Create `test/server/*.test.js`: unit and API tests.
- Modify `package.json`, `vite.config.js` (if present; inspect before editing), frontend `src/main.js`, and `README.md` for server scripts, proxy, mode UI and documentation.
- Keep `src/logic.js` as source for class split/validation semantics where practical; avoid duplicating those semantics silently.

## Task 1: Lock server image and model contracts with tests

**Files:**
- Create: `server/image-input.js`
- Create: `test/server/image-input.test.js`
- Create: `server/model-store.js`
- Create: `test/server/model-store.test.js`

- [ ] **Step 1: Write failing tests for image limits and preprocessing contract**

Test that allowed JPEG/PNG buffers within dimensions/byte limit are accepted, malformed data and unsupported formats are rejected, oversized input is rejected, and metadata identifies RGB, 224×224 MobileNet input and input range `[0, 1]`.

- [ ] **Step 2: Run tests and confirm they fail because modules are absent**

Run: `node --test test/server/image-input.test.js test/server/model-store.test.js`
Expected: FAIL with missing module/import errors.

- [ ] **Step 3: Implement image validation and model manifest primitives**

Use a maintained Node image decoder (choose `sharp` after checking Windows/Linux installation viability) to inspect actual file format/dimensions, resize via a documented policy to the MobileNet input dimensions and emit the exact RGB float tensor expected by `infer(..., true)`. First record the current browser's actual MobileNet preprocessing behavior on the deterministic fixture; do not assume a new square crop is equivalent. Manifest defines format version, MobileNet package/version/config, embedding dimension 1280, normalization and ordered class metadata.

- [ ] **Step 4: Implement atomic model-store metadata and path safety**

Use server-generated UUID model IDs, write model artifacts and manifest in a temporary version directory, then rename to publish. Reject invalid IDs and never interpolate unchecked user paths.

- [ ] **Step 5: Run focused tests**

Run: `node --test test/server/image-input.test.js test/server/model-store.test.js`
Expected: PASS, including invalid input and atomic publish failure cases.

## Task 2: Add single-job lifecycle tests and implementation

**Files:**
- Create: `server/job-store.js`
- Create: `test/server/job-store.test.js`

- [ ] **Step 1: Test job state transitions**

Cover queued → running → completed, queued/running → failed, progress updates, one active job conflict, unknown job lookup, and retention of completed status for polling.

- [ ] **Step 2: Confirm new tests fail**

Run: `node --test test/server/job-store.test.js`
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement an in-memory one-job store**

Return generated job IDs; permit only one active training job; store phase, percent, message, metrics and model ID; do not store image contents in the status object.

- [ ] **Step 4: Run focused tests**

Run: `node --test test/server/job-store.test.js`
Expected: PASS with no overlapping active jobs.

## Task 3: Implement reusable TFJS Node worker with a parity test

**Files:**
- Create: `server/training-worker.js`
- Create: `server/ml-service.js`
- Create: `test/server/training-worker.test.js`
- Modify: `package.json`

- [ ] **Step 1: Add a failing worker smoke test**

Test that worker initialization reports its backend, loads MobileNetV2, produces `[1,1280]` embedding for a fixed fixture, trains a classifier on a tiny generated dataset, and returns finite probabilities summing approximately to 1.

- [ ] **Step 2: Install compatible server dependencies**

Add `@tensorflow/tfjs-node` at a version aligned with current TFJS dependencies and the chosen image decoder. Verify native install in the current Windows development environment and Linux deployment environment; document if a specific supported Node version is required. Keep mobileNet image decoding/preprocessing outside `tf.browser` APIs so it works in Node.

- [ ] **Step 3: Implement shared model pipeline**

Initialize the native backend once. Load MobileNet once with explicit version 2, alpha 1, inputRange `[0,1]`; generate embeddings via the same MobileNet `infer(..., true)` contract as client. Keep current split semantics, Dense(64,relu) → Dense(classes,softmax), Adam/categorical-crossentropy/25 epochs initially. Report phases/epoch metrics through worker messages. Dispose input/intermediate tensors in `finally` paths.

- [ ] **Step 4: Implement model artifact serialization and loading**

Save/load the classifier LayersModel with TFJS filesystem IO in version directory and emit manifest including ordered classes, feature dimension, extractor configuration, and preprocessing version. Add `loadActiveModel` and `predictFrame` using the same feature extractor.

- [ ] **Step 5: Test server/browser artifact interchange and feature parity**

Use a checked-in deterministic PNG fixture. Load the saved head using browser Playwright and `tf.loadLayersModel` from the real artifact API URL, including `model.json` and all referenced weight shards; assert output dimension and ordered class metadata. For the exact same fixture, compare decoded canonical RGB input and MobileNet embeddings from client and server within documented tolerance, then compare predictions. Preserve current crop/resize behavior where feasible; any deliberate canonical preprocessing change must be applied identically in both environments and covered by this test.

- [ ] **Step 6: Run focused test and dependency check**

Run: `node --test test/server/training-worker.test.js`
Expected: PASS; Node reports the intended `node` backend and no leaked tensors after repeated runs.

## Task 4: Isolate TF compute and implement the API

**Files:**
- Create: `server/routes.js`
- Create: `server/index.js`
- Create: `test/server/api.test.js`
- Modify: `package.json`
- Modify: `vite.config.js` (only if it exists and needs an `/api` proxy)

- [ ] **Step 1: Write failing API tests**

Cover `POST /api/train`, polling status, one active job conflict, model JSON/weight delivery, JPEG server prediction, malformed multipart, wrong MIME versus actual decode, byte/count/class limits, and unavailable model response.

- [ ] **Step 2: Add Fastify and multipart dependencies**

Add Fastify and supported multipart plugin; set explicit body/file limits and route schemas. Keep same-origin API paths.

- [ ] **Step 3: Add worker-thread RPC wrapper**

Create exactly one long-lived worker thread per server process with message protocol for start-train/progress/result/error and predict. Serialize training and server inference through that worker. Ensure requests are not executed in Fastify's event loop; handle worker crash, shutdown and restart, and one-job conflict. Tests must show health/status routes stay responsive during a synthetic long-running job, prediction and training never execute concurrently, and worker errors reject active requests cleanly.

- [ ] **Step 4: Implement train route with bounded temporary uploads**

Stream accepted files into a per-job temporary directory; validate actual file contents and count/total bytes; pass paths and class metadata to worker. Return job ID, remove temporary input on completion/failure, preserve previous active model until new version atomically publishes.

- [ ] **Step 5: Implement status, artifact, and prediction routes**

Status returns current job state and metrics. Artifact route serves only files from validated published model directories, including `model.json` and each relative weight shard with correct content type/cache policy. Prediction accepts one JPEG, normalizes via shared preprocessing, invokes worker sequentially and returns `{modelId, classes, probabilities}`. Add authentication middleware for all training, status details, artifact and prediction endpoints; reject requests without a valid configured token.

- [ ] **Step 6: Add start/dev scripts and Vite proxy**

Add `npm run server` and a dev script that starts Vite and Fastify appropriately (use an existing repo runner if present; avoid adding a process manager unnecessarily). Configure `/api` proxy for local development. Ensure production serves `dist` and API from one origin.

- [ ] **Step 7: Run API tests**

Run: `node --test test/server/api.test.js`
Expected: PASS, including authorization failures on every protected route, repeated training/prediction requests without event-loop starvation, upload byte/count limits, temporary directory cleanup on worker failure, and preserving prior valid model on failed training.

## Task 5: Add UI for both server prediction modes

**Files:**
- Modify: `src/main.js`
- Modify: `src/logic.js` and `test/logic.test.js` only if mode-state logic merits extraction
- Modify: `test/browser_training.py` or add `test/browser_server_modes.py`

- [ ] **Step 1: Write browser tests for mode selection and frame behavior**

Test that training submission uses current images/class order, progress polls to completion, client mode loads remote classifier head and keeps camera processing local, server mode uploads JPEG frames one-at-a-time, and stopping camera/mode cancels pending prediction loop.

- [ ] **Step 2: Add a training-mode UI state and API client**

Offer “Серверное обучение” (default server mode) and preserve existing example collection/settings. Upload image files as binary multipart rather than serializing base64 JSON; poll with bounded backoff and show feature extraction/epoch progress and validation metrics.

- [ ] **Step 3: Load server-trained head for client prediction**

Upon completion, load the returned head model via TFJS HTTP LayersModel loader, check manifest/extractor compatibility and output class count/order, then compose local MobileNet features with this head in the existing prediction loop.

- [ ] **Step 4: Implement client camera inference mode**

Reuse the existing local extractor; make result retrieval asynchronous (`data()`), avoid overlapping frame work, and update predictions UI at a controlled rate. Client mode must not POST camera frames.

- [ ] **Step 5: Implement server camera inference mode**

Draw a reusable 224×224 (or manifest-compatible size) canvas and JPEG encode. Send a frame only after prior prediction completes; discard queued/stale frames; render same class/threshold/effects. Display network/model latency and errors without stopping camera capture.

- [ ] **Step 6: Keep games and stop controls coherent**

Ensure camera prediction stop, camera stop, model replacement, tab changes, and mode changes abort active fetches and cancel game lifecycle; verify no stale response updates the UI.

- [ ] **Step 7: Run browser integration tests and current regression suite**

Run: `npm test` and the browser test runner for both prediction modes with a synthetic dataset/camera fixture.
Expected: both modes reach a valid prediction; the server mode sends no overlapping requests; existing project save/load and game tests continue to pass.

## Task 6: Document deployment, security and benchmark procedure

**Files:**
- Modify: `README.md`
- Create: `docs/server-deployment.md`
- Modify: `package.json` if production build/start scripts need to be finalized

- [ ] **Step 1: Document local run and production deployment**

List supported Node version/platform, native `tfjs-node` install prerequisites, build/start commands, model/data directories, HTTPS reverse proxy expectations, and persistence/backup behavior.

- [ ] **Step 2: Document security and retention settings**

Describe auth token configuration, upload/number-of-examples/request-size limits, private storage permissions, data deletion and single-user scope. Production startup must refuse to start if API auth is not configured.

Implement and test auth middleware (not merely document it): without a valid token, train, job status, model artifact and predict endpoints all return 401; health endpoint exposes no private metadata. Local development may use an explicit dev-only token, but production must fail startup if the token is missing.

- [ ] **Step 3: Add repeatable benchmark command and reporting format**

Measure cold start, image decode, embedding extraction, classifier fit, client warm inference, server inference, request RTT and peak RSS using a fixed image set. Report sample count, image dimensions, OS/CPU/backend and percentile timings; do not set unsupported universal FPS claims.

- [ ] **Step 4: Run full verification**

Run: `npm test`
Run: `npm run build`
Run: API smoke/integration tests and browser tests for both modes.
Expected: all commands pass; README accurately reflects modes and data handling.

## Completion criteria

- Feature extraction and classifier training happen only on server for new training jobs.
- Browser inference uses the same server-trained classifier head plus the browser MobileNet extractor; server inference uses the same model contract.
- The two modes share the same class order, confidence threshold semantics and effects.
- Model artifact compatibility is checked; client/server parity test passes on fixed input.
- Long-running ML does not block the HTTP request loop; one job and one server prediction are serialized in initial single-user deployment.
- Input limits, authentication, atomic model publication, cleanup and documented deployment are present.
- Tests and production build pass; benchmark numbers are recorded for the actual VPS before making speed guarantees.

## Additional mandatory lifecycle checks

- Add API integration test that starts server with an existing active model directory, restarts it, and verifies current model ID and prediction still work.
- Add failure injection during model save/publication and verify the old active version remains available and is not deleted.
- Add test for corrupted/missing active weights: server reports unavailable model and does not attempt unsafe paths.
- Add worker shutdown/restart test and assert temporary job directories are removed after worker crash.
