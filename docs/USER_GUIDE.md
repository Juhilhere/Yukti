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

### Reading citations

Every source under an answer tells you where the information came from, so you can check it before you act:

| You see | What it means |
|---|---|
| **Document and revision** | The document number, its revision and whether it is **CURRENT** or **SUPERSEDED**. Prefer the current revision. |
| **Page or record ID** | `p.3` for a page, or `record A2_WorkOrders!34` for one row of a spreadsheet (sheet name and row number). |
| **Date** | The document's effective date, or the date it was added to Yukti if it has none. |
| **Confidence** | 0 to 1: how well this passage matched your question compared with the best match. For a scanned page it is also lowered by how sure the OCR was, and the OCR confidence is shown separately. |
| **Known / Missing / Conflicting** | On each fact `[F1]` …: **KNOWN** (one value, with its source), **MISSING** (no document you may read has it: Yukti says so instead of guessing) or **CONFLICTING** (sources disagree: every value is listed with its source and revision, and the current one is recommended). |
| **Channel chips** | How the passage was found: **bm25** (keywords), **tags** (the equipment tag in your question), **metadata** (a document type that fits the question, for example an SOP for a procedure question), **graph** (a document linked to the asset, such as its procedure or a document it refers to; the reason is shown, e.g. *documented in A2*) and **vector** (meaning-based search, only when your plant has installed it). |

Whatever channel found a passage, you only ever see documents you are allowed to read.

### Who answered: the worker badge

Each answer shows a small **worker** badge: which part of Yukti did the work. Laya picks it before any AI model is called.

| Badge | What it means |
|---|---|
| Policy engine (no model) | A refusal, an off-topic question or a need-to-know note. No AI model was used. |
| Small quantized LLM | The everyday answer from your documents. |
| OCR + vision-language model | Your question had a photo. |
| Deterministic analytics engine | For example *"what expires soon?"*: the answer comes straight from the asset ledger. |
| Reasoning model | Questions that ask *why*, *compare* or *root cause*. If your administrator has assigned a larger reasoning model but it is not the one loaded, the badge says the loaded model answered instead. |
| Sandboxed coding model | Questions that ask for a script or calculation code. Code is never run by itself (see *Workbench*). |
| Workflow engine | Access requests and approvals. |

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
Speech is recognised with Whisper (whisper.cpp). For Hindi and Kannada, Yukti uses AI4Bharat's IndicWhisper model for that language when your
administrator has installed it.

**Administrators:** photos and voice are optional abilities, downloaded once after installation. On the server
computer, the home screen shows **New abilities for Yukti → Add**; they can also be added or removed under
*Admin → New abilities*. Until the photo ability is added, Yukti can still read the writing on a photo but cannot see the picture.

Good to know:

- Yukti answers **only from documents you are allowed to read** and cites them. If something is missing, it says so rather than guessing.
- For isolation or LOTO steps it quotes the current approved procedure. **Always verify with the permit-to-work; Yukti is advisory only.**
- Yukti never changes setpoints, interlocks or control logic. It will tell you to raise a Management-of-Change request instead.
- Documents marked **EXAMPLE** were written by Team UniMinds for demonstration and are not MRPL data.

## Workbench: get a finished file

**Workbench** turns a request into a real file, written on the plant server. Nothing leaves the premises.

1. Choose what you want:

   | Deliverable | You get |
   |---|---|
   | **Approval note (.docx)** | A Word approval note with *Background, Proposal, Justification, Safety and risk, Cost and materials*, the approver lane and approver, a sign-off table and the sources. |
   | **Word document** | A short technical document drafted from the documents you may read, with a sources table. |
   | **PowerPoint deck** | 4 to 7 slides drafted from the evidence, plus a title slide and a sources slide. |
   | **Excel workbook** | Rows from authorised spreadsheets, and for an equipment tag its work orders, ledger entries and facts, plus a *Sources* sheet. |
   | **Calculation with steps** | Every step shown: the formula, the formula with your values put in, and the result (see below). Saved as an Excel file. |
   | **Code (sandbox)** | The coding model writes a Python script. You read it, then press **Run in sandbox** if you want to run it. |
   | **Cited answer** | A written answer with citations, without a file. |

2. Describe the work in a sentence, for example *"Draft an approval note for replacing the A2 motor bearings"*. Add the equipment tag if Yukti
   does not find it in your sentence.
3. Yukti shows each step as it runs (search documents, read facts, read records, draft, write the file). Download the file when it is done.

Good to know:

- Yukti uses **only the documents and records you are allowed to read**. Each step is checked by the policy engine and written to the audit log.
- Every file says *"Drafted by Yukti. Advisory only: it takes effect only when the accountable approver signs it."* Check it before you use it.
- Without an AI model loaded, Yukti still builds the file, but from quoted passages only, and says so.
- Each file is fingerprinted (SHA-256) and recorded. Only you can download your files; an approval note can also be opened by the people who may see its finding.

**Calculations.** Write one step per line as `name = formula [unit]`, for example:

```
P = 75000 [W]
V = 415 [V]
pf = 0.86
I = P / (sqrt(3) * V * pf) [A]
```

Yukti shows each line with your numbers put in, and the result. You can use `sqrt`, `log`, `exp`, `sin`, `cos`, `pi`, `min`, `max`, `round` and
similar. No code is run for a calculation.

**Code in the sandbox.** Code runs only when you press **Run in sandbox**, in a separate process on the server with a time limit (20 s), a
memory limit, no network, and only calculation and data libraries (`math`, `statistics`, `numpy`, `pandas`, `openpyxl` and a few more). It can
only open files in its own folder; files it writes come back to you. Contract workers cannot run code.

## Request access

If an answer says documents were withheld, or a document shows *Request access*:

1. Click **Request access**. Choose the department, document type or document, write a justification and choose how many hours you need.
2. Your request goes to that department's Head of Department. You get a notification when it is decided.
3. Approved access is **time-bound**. It expires automatically.

## Inbox

**Inbox — approvals & access** lists your access requests, findings for your discipline and notifications. Only the actions you are allowed to take
are shown on each finding (for example *Acknowledge*, *Escalate* or *Add note*). Approvers also see *Approve* and *Reject*.

### Approver lanes, acknowledgement, escalation and follow-up

Different decisions have different approvers. Every finding belongs to one **lane**: **Electrical**, **Mechanical**, **HSE**, **Procurement**,
**Finance** or **Management**. Each finding card shows its lane, the owning department, the approver, the due date, the applicable procedure
(document number and revision), the evidence and, when it came from a scan, the **approval note** to download.

- **Acknowledge** to show you have seen it. Yukti records when.
- If nobody acknowledges in time (**24 h** for high severity, **72 h** for medium, **168 h** for low), Yukti escalates it by itself
  (**AUTO-ESCALATED**) and tells the next person.
- **Escalate** moves it one level up: lane approver → Head of Department → refinery management → top management.
- When the due date has passed, the approver and the Head of Department get a reminder once a day until it is decided.

### Scan review

People who check scans (engineers, HSE, Heads of Department and refinery management) also see a **Scan review** tab. It lists fields Yukti
could not read with confidence, or that do not match the asset master, for findings of your department (HSE and refinery management see all
departments). You see only scans you are allowed to read.

For each item you see the field, the value Yukti read, the value it expected (if any), the reason and the place on the page. Choose:

- **Confirm**: the value is right.
- **Correct**: type the right value.
- **Dismiss**: the value is wrong. If the finding rests on that value (for example a thickness reading), the finding is withdrawn.

When the last item is decided, the finding is raised, an approval note is drafted and it goes to the lane's approver. Until then the finding is
a **DRAFT** that only reviewers see.

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

### Scan to finding

A scanned inspection report, calibration certificate or test record can become a finding with an owner and a deadline, so it is not forgotten
in a folder. Engineers, HSE, Heads of Department and refinery management can start it on a scanned document they may read: open the document and
click **Scan to finding**. Yukti then:

1. reads the text, tables, dates, serial numbers and equipment tags (OCR), with the position of every line on the page;
2. asks the vision model about stamps, signatures, layout, drawing symbols and safety markings (skipped, and said so, when no vision model is loaded);
3. picks out the fields: report number, dates, tag, serial, make and model, thickness readings, valve pressures, test results;
4. checks them against the asset master: tag, plant unit, serial number, make and model, design limits and the ledger due date;
5. sends fields read with low confidence, and any mismatch, to **Scan review** (above) before anything is raised;
6. raises the finding, linked to the asset, the procedure, the owning department, a due date and the place on the page where the evidence is;
7. drafts the approval note (.docx) and routes it to the approver of the right lane.

Nothing is guessed: a value Yukti cannot read is asked for, not invented. The steps are shown as they run.

HODs also approve access requests for their department and can view the audit log.

## Assets & compliance

**Assets & compliance** shows equipment with its certificates, calibrations and inspections, and days to expiry. Red and amber alerts appear in the top
bar. Open an asset to see work orders and related documents, and click **Generate dossier (PDF)**.

### The asset ledger and expiry alerts

Everything purchased or installed can be kept in the digital asset ledger: vendor, serial number, location, owner, certificate, inspection
interval, warranty and expiry date. Each entry has a category, and each category warns you a set number of days before it lapses:

| Category | Warns | Default interval |
|---|---|---|
| Fire extinguisher | 30 days before | 12 months |
| Calibration record | 30 days before | 12 months |
| Pressure-vessel inspection | 60 days before | 24 months |
| Safety device (PSV, gas detector, SCBA) | 30 days before | 12 months |
| Spare part (shelf life) | 45 days before | — |
| Licence or statutory permit | 45 days before | 12 months |
| Certificate | 30 days before | 12 months |
| Warranty | 30 days before | — |

An entry can set its own warning time. Warranty ends are alerted too. Alerts turn **red** 7 days before the date and stay red once it has passed.

Stores, HSE, Heads of Department and refinery management can change the ledger (for their own department; stores and refinery management for
any asset they can see):

- **Register asset**: tag, name, plant unit, class, vendor, model, serial, location, owning department and criticality.
- **Add ledger entry**: choose the category, then the reference number, vendor, serial, location, owner, certificate, dates and interval. If you
  give the issue date and the interval, Yukti works out the expiry date.
- **Renew**: after a new inspection or certificate, enter the new issue date (and reference or certificate number). The next due date follows from
  the interval unless you enter one.

You can also ask in Chat, for example *"what expires in the next two months?"*. The answer comes straight from the ledger, limited to assets you may see.

## MRPL Intelligence

**MRPL Intelligence** shows public information about MRPL (organisation, refinery units, products, financials) with a link to the source for every
figure. Where public sources disagree, all values are shown.

## Production intelligence (planners)

Planners see MRPL's published production and sales data. To run scenarios, a planner first enters the plant model: units, feeds, yields, capacities,
prices and crude cost. **The optimizer refuses to run until the model is complete**, and it lists exactly what is missing. It never makes numbers up.

The plant model can also hold, per product, monthly demand history, opening inventory, storage and dispatch limits, contract minimums, a crack
spread instead of a price, and a specification note; and for the plant, the crude available and each unit's planned maintenance days.

### The scenario card (Plan)

**Plan** answers *"what product mix should we examine next month?"*:

1. A **forecast** estimates next month's demand for every product with at least 3 months of history, with a low and a high value (80 % range).
   Products without history use only your own limits.
2. The **optimizer** (HiGHS) compares feasible mixes within capacities, yields, maintenance and scenario downtime, inventory and storage, dispatch
   limits, contracts and crude availability, for expected, low and high demand.
3. The **scenario card** shows the proposed change per product in %, the expected monthly margin against the baseline, the alternatives for low and
   high demand, the binding constraints, the assumptions, and a short explanation.

The optimizer calculates, the AI explains and **planners decide**. If the AI's wording contains a number that is not in the optimizer's result, the
wording is withheld. Yukti never changes DCS or SCADA setpoints.

## Research layer (researchers only)

People with the **researcher** role see a **Research** page. It lets you ask questions of an experimental model that your administrator runs
separately from the plant AI.

- Every answer is labelled **EXPERIMENTAL**. It is not for operational use.
- The research model gets **no plant documents, no tools and no approvals**. The page shows that the isolation rule denied it documents.
- Production chats, the Workbench, approvals and the optimizer never use it.
- Each question is recorded in the audit log as a short fingerprint, not as text.

## Account & security

- **Account & security**: change your password; turn on **Two-factor authentication (MFA)** by scanning the QR code and entering a code.
  **Save the 10 recovery codes** somewhere safe. Each works once.
- **Sessions**: see where you are signed in, and revoke a session or **Log out all devices**.
- **Settings → Language**: English, हिंदी or ಕನ್ನಡ.
