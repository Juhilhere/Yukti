# Yukti user guide

This guide is for employees and Heads of Department. Administrators should also read the [Admin Guide](ADMIN_GUIDE.md).

## Sign in

1. Open the **Yukti** desktop app. On first run, choose **Connect to our plant Yukti server** and enter the address your administrator gave you,
   for example `http://yukti-server:8000`. You can also open that address in a browser.
2. Enter your username and password. If your administrator created the account or reset your password, you must set a new password first:
   at least 12 characters, with letters and digits.
3. If two-factor authentication is on, enter the 6-digit code from your authenticator app, or one of your recovery codes.

The top bar shows your clearance level (e.g. `L1 INTERNAL`). Sessions end after 30 minutes idle or 10 hours total.

## Ask a question (Chat)

1. Go to **Chat** and type your question in plain language. You can also use Hindi or Kannada terms. For example:
   *"A2 tripped at 02:15 — give me the isolation and restart dossier"*.
2. While the answer is written, Yukti shows:
   - **Route**: what Laya understood (intent, department, urgency).
   - **Guard**: the company-guardrail decision and the rule that applied.
   - **Sources** `[S1]`, `[S2]` …: the document, revision, status (CURRENT / SUPERSEDED) and page for each citation. Click a source to open it.
   - **Facts** `[F1]` …: values marked **KNOWN**, **MISSING** or **CONFLICTING**. For conflicts you see every candidate with its source and revision,
     and the recommended (current) one.
   - **Withheld**: how many relevant documents exist that you are not allowed to see, and which departments hold them.
3. Use **Stop** to end an answer early and **Regenerate** to try again. Rate answers with 👍 / 👎 and optionally add a comment. Administrators review this feedback.

### Ask with a photo 📷

1. Click **📷 Add photo** next to the question box, take a photo (for example of a pipe label, tag plate, nameplate or
   gauge) or choose one. You can add up to 4, paste them, or drag them onto the chat.
2. Type a question (or none: Yukti then describes the photo) and send.
3. **What Yukti read in the photo** shows the writing it found and the equipment tags it recognised.

Yukti names a line, a chemical or a piece of equipment **only from a tag or label it can read, matched with the plant's
documents**. It never guesses from the colour of a pipe. If no tag is readable, it says so and asks for the line number.
It points out rust, leaks and damage, but a photo is never proof that something is safe. Gauge readings from a photo are
approximate: check the instrument. Your photos are visible only to you, have their location data removed, and are
deleted when you delete the chat.

### Speak instead of typing 🎙️

1. Click **🎙️ Speak** and say your question in English, Hindi or Kannada. Click **Done** when you finish (at most 1 minute).
2. The words appear in the question box. **Check and correct them**, then press Send. Nothing is sent by itself.

Speak close to the microphone; background noise is handled, but a quiet voice may not be heard. Equipment tags such as
*"pump A2"* or *"exchanger E-310"* are recognised best when you say the type of equipment before the tag.

**Administrators:** photos and voice are optional abilities, downloaded once after installation. On the server
computer, the home screen shows **New abilities for Yukti → Add**; they can also be added or removed under
*Admin → New abilities*. Until the photo ability is added, Yukti can still read the writing on a photo but cannot see the picture.

Good to know:

- Yukti answers **only from documents you are allowed to read** and cites them. If something is missing, it says so rather than guessing.
- For isolation or LOTO steps it quotes the current approved procedure. **Always verify with the permit-to-work; Yukti is advisory only.**
- Yukti never changes setpoints, interlocks or control logic. It will tell you to raise a Management-of-Change request instead.
- Documents marked **EXAMPLE** were written by Team UniMinds for demonstration and are not MRPL data.

## Request access

If an answer says documents were withheld, or a document shows *Request access*:

1. Click **Request access**. Choose the department, document type or document, write a justification and choose how many hours you need.
2. Your request goes to that department's Head of Department. You get a notification when it is decided.
3. Approved access is **time-bound**. It expires automatically.

## Inbox

**Inbox — approvals & access** lists your access requests, findings for your discipline and notifications. Only the actions you are allowed to take
are shown on each finding (for example *Acknowledge*, *Escalate* or *Add note*). Approvers also see *Approve* and *Reject*.

## Knowledge

**Knowledge** lists every document you may read, with its number, revision, status, classification, and how many pages are digital or scanned.
Open a document to read the extracted text page by page, or to download the original.

### Heads of Department: add and remove documents

Only HODs can add documents, and only for **their own department**.

1. In **Knowledge**, click **Upload**. Choose the file (PDF, DOCX, XLSX, TXT, PNG or JPG, up to 50 MB).
2. Enter the title, document type, classification (not above your own clearance), document number and revision.
3. Follow the ingestion stages: *Store & fingerprint → Detect type & page modes → Extract text / OCR → Tag assets → Chunk → Index*.
   Scanned pages are OCR'd automatically.
4. If you upload a new revision with the same document number, the older revision is marked **SUPERSEDED**.
5. To remove a document, open it and click **Delete**. You can delete only your own department's documents.

HODs also approve access requests for their department and can view the audit log.

## Assets & compliance

**Assets & compliance** shows equipment with its certificates, calibrations and inspections, and days to expiry. Red and amber alerts appear in the top
bar. Open an asset to see work orders and related documents, and click **Generate dossier (PDF)**.

## MRPL Intelligence

**MRPL Intelligence** shows public information about MRPL (organisation, refinery units, products, financials) with a link to the source for every
figure. Where public sources disagree, all values are shown.

## Production intelligence (planners)

Planners see MRPL's published production and sales data. To run scenarios, a planner first enters the plant model: units, feeds, yields, capacities,
prices and crude cost. **The optimizer refuses to run until the model is complete**, and it lists exactly what is missing. It never makes numbers up.

## Account & security

- **Account & security**: change your password; turn on **Two-factor authentication (MFA)** by scanning the QR code and entering a code.
  **Save the 10 recovery codes** somewhere safe. Each works once.
- **Sessions**: see where you are signed in, and revoke a session or **Log out all devices**.
- **Settings → Language**: English, हिंदी or ಕನ್ನಡ.
