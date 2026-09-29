"""Translations of server messages. MESSAGES: exact English text -> {"hi": ..., "kn": ...}.
PATTERNS: (compiled regex with named groups matching the whole English message, {"hi": template, "kn": template});
templates use {group} placeholders. A group named t_* holds a nested English message that is translated too.
Unknown messages stay in English.

Written for refinery staff: simple everyday words; technical tokens (SOP, LOTO, P&ID, HOD, GPU, GGUF, Ollama, llama.cpp,
tag and document numbers, file names, classification labels) stay in Latin script."""
from __future__ import annotations

import re

MESSAGES: dict[str, dict[str, str]] = {}
PATTERNS: list[tuple[re.Pattern[str], dict[str, str]]] = []


def M(en: str, hi: str, kn: str) -> None:
    MESSAGES[en] = {"hi": hi, "kn": kn}


def P(rx: str, hi: str, kn: str) -> None:
    PATTERNS.append((re.compile(rx, re.S), {"hi": hi, "kn": kn}))


# ============================================================== sign-in, session, password (auth.py)
M("Invalid username or password.", "उपयोगकर्ता नाम या पासवर्ड गलत है।", "ಬಳಕೆದಾರ ಹೆಸರು ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.")
M("Please sign in.", "कृपया साइन इन करें।", "ದಯವಿಟ್ಟು ಸೈನ್ ಇನ್ ಮಾಡಿ.")
M("Your session expired. Please sign in again.", "आपका सत्र समाप्त हो गया है। कृपया फिर से साइन इन करें।",
  "ನಿಮ್ಮ ಸೆಷನ್ ಮುಗಿದಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಸೈನ್ ಇನ್ ಮಾಡಿ.")
M("Account disabled.", "खाता बंद कर दिया गया है।", "ಖಾತೆಯನ್ನು ನಿಷ್ಕ್ರಿಯಗೊಳಿಸಲಾಗಿದೆ.")
M("Missing or invalid CSRF token.", "सुरक्षा टोकन (CSRF) नहीं मिला या गलत है। पेज को फिर से लोड करें।",
  "ಭದ್ರತಾ ಟೋಕನ್ (CSRF) ಇಲ್ಲ ಅಥವಾ ತಪ್ಪಾಗಿದೆ. ಪುಟವನ್ನು ಮತ್ತೆ ಲೋಡ್ ಮಾಡಿ.")
M("You must change your password before continuing.", "आगे बढ़ने से पहले आपको अपना पासवर्ड बदलना होगा।",
  "ಮುಂದುವರಿಯುವ ಮೊದಲು ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಬದಲಾಯಿಸಬೇಕು.")
M("This account is disabled. Contact the administrator.", "यह खाता बंद है। व्यवस्थापक (एडमिन) से संपर्क करें।",
  "ಈ ಖಾತೆ ನಿಷ್ಕ್ರಿಯವಾಗಿದೆ. ನಿರ್ವಾಹಕರನ್ನು (ಅಡ್ಮಿನ್) ಸಂಪರ್ಕಿಸಿ.")
M("Enter the 6-digit code from your authenticator app.", "अपने ऑथेंटिकेटर ऐप से 6 अंकों का कोड डालें।",
  "ನಿಮ್ಮ ಆಥೆಂಟಿಕೇಟರ್ ಆ್ಯಪ್‌ನಲ್ಲಿರುವ 6 ಅಂಕಿಯ ಕೋಡ್ ನಮೂದಿಸಿ.")
M("Invalid authentication code.", "प्रमाणीकरण कोड गलत है।", "ದೃಢೀಕರಣ ಕೋಡ್ ತಪ್ಪಾಗಿದೆ.")
M("Current password is incorrect.", "मौजूदा पासवर्ड गलत है।", "ಈಗಿನ ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.")
M("New password must differ from the current one.", "नया पासवर्ड मौजूदा पासवर्ड से अलग होना चाहिए।",
  "ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ಈಗಿನ ಪಾಸ್‌ವರ್ಡ್‌ಗಿಂತ ಬೇರೆಯಾಗಿರಬೇಕು.")
M("Password must be at least 12 characters.", "पासवर्ड कम से कम 12 अक्षरों का होना चाहिए।",
  "ಪಾಸ್‌ವರ್ಡ್ ಕನಿಷ್ಠ 12 ಅಕ್ಷರಗಳಿರಬೇಕು.")
M("Password must contain letters and digits.", "पासवर्ड में अक्षर और अंक दोनों होने चाहिए।",
  "ಪಾಸ್‌ವರ್ಡ್‌ನಲ್ಲಿ ಅಕ್ಷರಗಳು ಮತ್ತು ಅಂಕಿಗಳು ಎರಡೂ ಇರಬೇಕು.")
M("Code did not match. Check the time on your phone and try again.",
  "कोड मेल नहीं खाया। अपने फ़ोन का समय जाँचें और फिर से कोशिश करें।",
  "ಕೋಡ್ ಹೊಂದಿಕೆಯಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಫೋನ್‌ನ ಸಮಯವನ್ನು ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.")
M("Password is incorrect.", "पासवर्ड गलत है।", "ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.")
M("Enter the current code from your authenticator app (or a recovery code).",
  "अपने ऑथेंटिकेटर ऐप का मौजूदा कोड (या कोई रिकवरी कोड) डालें।",
  "ನಿಮ್ಮ ಆಥೆಂಟಿಕೇಟರ್ ಆ್ಯಪ್‌ನ ಈಗಿನ ಕೋಡ್ (ಅಥವಾ ರಿಕವರಿ ಕೋಡ್) ನಮೂದಿಸಿ.")
M("Not available.", "उपलब्ध नहीं है।", "ಲಭ್ಯವಿಲ್ಲ.")
P(r"Missing permission: (?P<perm>.+)", "आपको यह काम करने की अनुमति नहीं है ({perm})।", "ಈ ಕೆಲಸ ಮಾಡಲು ನಿಮಗೆ ಅನುಮತಿ ಇಲ್ಲ ({perm}).")
P(r"Too many failed sign-in attempts\. Try again in (?P<n>\d+) minutes?, or ask the administrator to unlock the account\.",
  "बहुत बार गलत साइन-इन हुआ। {n} मिनट बाद फिर से कोशिश करें, या खाता खुलवाने के लिए व्यवस्थापक से कहें।",
  "ಹಲವು ಬಾರಿ ತಪ್ಪಾಗಿ ಸೈನ್ ಇನ್ ಪ್ರಯತ್ನಿಸಲಾಗಿದೆ. {n} ನಿಮಿಷದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ಖಾತೆ ತೆರೆಯಲು ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.")

# ============================================================== users & administration (admin.py)
M("username is required", "उपयोगकर्ता नाम ज़रूरी है", "ಬಳಕೆದಾರ ಹೆಸರು ಕಡ್ಡಾಯ")
M("display name is required", "दिखने वाला नाम ज़रूरी है", "ತೋರಿಸುವ ಹೆಸರು ಕಡ್ಡಾಯ")
M("department is required", "विभाग ज़रूरी है", "ವಿಭಾಗ ಕಡ್ಡಾಯ")
M("username may contain letters, digits, dot, dash and underscore (2-40 characters)",
  "उपयोगकर्ता नाम में केवल अक्षर, अंक, बिंदु (.), डैश (-) और अंडरस्कोर (_) हो सकते हैं (2-40 अक्षर)",
  "ಬಳಕೆದಾರ ಹೆಸರಿನಲ್ಲಿ ಅಕ್ಷರಗಳು, ಅಂಕಿಗಳು, ಬಿಂದು (.), ಡ್ಯಾಶ್ (-) ಮತ್ತು ಅಂಡರ್‌ಸ್ಕೋರ್ (_) ಮಾತ್ರ ಇರಬಹುದು (2-40 ಅಕ್ಷರಗಳು)")
M("clearance must be 0-4", "अनुमति स्तर (clearance) 0 से 4 के बीच होना चाहिए", "ಅನುಮತಿ ಮಟ್ಟ (clearance) 0 ರಿಂದ 4 ರ ನಡುವೆ ಇರಬೇಕು")
P(r"Unknown department: (?P<d>.+)", "यह विभाग मौजूद नहीं है: {d}", "ಈ ವಿಭಾಗ ಇಲ್ಲ: {d}")
P(r"Unknown role: (?P<r>.+)", "यह भूमिका (role) मौजूद नहीं है: {r}", "ಈ ಪಾತ್ರ (role) ಇಲ್ಲ: {r}")
P(r"User (?P<u>.+) already exists", "उपयोगकर्ता {u} पहले से मौजूद है", "ಬಳಕೆದಾರ {u} ಈಗಾಗಲೇ ಇದ್ದಾರೆ")
M("User not found", "उपयोगकर्ता नहीं मिला", "ಬಳಕೆದಾರರು ಸಿಗಲಿಲ್ಲ")
M("You cannot disable or demote your own admin account.", "आप अपना ही एडमिन खाता बंद नहीं कर सकते और न ही उसका पद घटा सकते हैं।",
  "ನಿಮ್ಮದೇ ಅಡ್ಮಿನ್ ಖಾತೆಯನ್ನು ನಿಷ್ಕ್ರಿಯಗೊಳಿಸಲು ಅಥವಾ ಅದರ ಹಂತ ಇಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.")
M("You cannot change your own clearance, department or asset scope.",
  "आप अपना ही अनुमति स्तर, विभाग या उपकरण-क्षेत्र नहीं बदल सकते।",
  "ನಿಮ್ಮದೇ ಅನುಮತಿ ಮಟ್ಟ, ವಿಭಾಗ ಅಥವಾ ಉಪಕರಣ ವ್ಯಾಪ್ತಿಯನ್ನು ಬದಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.")
M("You cannot change your own roles.", "आप अपनी ही भूमिकाएँ नहीं बदल सकते।", "ನಿಮ್ಮದೇ ಪಾತ್ರಗಳನ್ನು ಬದಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.")
M("The file needs a header row with at least a 'username' column (download the template).",
  "फ़ाइल की पहली पंक्ति में कॉलम के नाम होने चाहिए, कम से कम 'username' कॉलम (टेम्पलेट डाउनलोड करें)।",
  "ಫೈಲ್‌ನ ಮೊದಲ ಸಾಲಿನಲ್ಲಿ ಕಾಲಮ್ ಹೆಸರುಗಳಿರಬೇಕು, ಕನಿಷ್ಠ 'username' ಕಾಲಮ್ (ಟೆಂಪ್ಲೇಟ್ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ).")
P(r"Unknown engine '(?P<e>.*)'", "यह इंजन मौजूद नहीं है: '{e}'", "ಈ ಎಂಜಿನ್ ಇಲ್ಲ: '{e}'")
M("Unknown engine", "यह इंजन मौजूद नहीं है", "ಈ ಎಂಜಿನ್ ಇಲ್ಲ")
M("Backup not found", "बैकअप नहीं मिला", "ಬ್ಯಾಕಪ್ ಸಿಗಲಿಲ್ಲ")
M("This backup file does not match its recorded SHA-256 checksum (damaged or altered). Not restored.",
  "यह बैकअप फ़ाइल अपने दर्ज SHA-256 चेकसम से मेल नहीं खाती (खराब या बदली हुई है)। बहाल नहीं किया गया।",
  "ಈ ಬ್ಯಾಕಪ್ ಫೈಲ್ ದಾಖಲಾದ SHA-256 ಚೆಕ್‌ಸಮ್‌ಗೆ ಹೊಂದಿಕೆಯಾಗುತ್ತಿಲ್ಲ (ಹಾಳಾಗಿದೆ ಅಥವಾ ಬದಲಾಗಿದೆ). ಮರುಸ್ಥಾಪಿಸಲಾಗಿಲ್ಲ.")
M("This backup is damaged or does not contain a Yukti database. Not restored.",
  "यह बैकअप खराब है या इसमें Yukti का डेटाबेस नहीं है। बहाल नहीं किया गया।",
  "ಈ ಬ್ಯಾಕಪ್ ಹಾಳಾಗಿದೆ ಅಥವಾ ಇದರಲ್ಲಿ Yukti ಡೇಟಾಬೇಸ್ ಇಲ್ಲ. ಮರುಸ್ಥಾಪಿಸಲಾಗಿಲ್ಲ.")
M("This backup is not a valid zip file. Not restored.", "यह बैकअप सही zip फ़ाइल नहीं है। बहाल नहीं किया गया।",
  "ಈ ಬ್ಯಾಕಪ್ ಸರಿಯಾದ zip ಫೈಲ್ ಅಲ್ಲ. ಮರುಸ್ಥಾಪಿಸಲಾಗಿಲ್ಲ.")
M("The database inside this backup is damaged. Not restored.", "इस बैकअप के अंदर का डेटाबेस खराब है। बहाल नहीं किया गया।",
  "ಈ ಬ್ಯಾಕಪ್‌ನೊಳಗಿನ ಡೇಟಾಬೇಸ್ ಹಾಳಾಗಿದೆ. ಮರುಸ್ಥಾಪಿಸಲಾಗಿಲ್ಲ.")
M("Backup checked and staged. Restart Yukti to replace the current data with it.",
  "बैकअप जाँचकर तैयार रख दिया गया है। मौजूदा डेटा को इससे बदलने के लिए Yukti को फिर से चालू करें।",
  "ಬ್ಯಾಕಪ್ ಪರಿಶೀಲಿಸಿ ಸಿದ್ಧವಾಗಿಡಲಾಗಿದೆ. ಈಗಿನ ಡೇಟಾವನ್ನು ಇದರಿಂದ ಬದಲಿಸಲು Yukti ಅನ್ನು ಮರುಪ್ರಾರಂಭಿಸಿ.")
M("Yukti is restarting; this page reconnects when it is back.",
  "Yukti फिर से चालू हो रहा है; वापस आने पर यह पेज अपने-आप जुड़ जाएगा।",
  "Yukti ಮರುಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ; ಅದು ಮರಳಿ ಬಂದಾಗ ಈ ಪುಟ ತಾನಾಗಿಯೇ ಸಂಪರ್ಕಗೊಳ್ಳುತ್ತದೆ.")
M("Path must point to an existing .gguf file on the server (e.g. a USB drive).",
  "पाथ सर्वर पर मौजूद किसी .gguf फ़ाइल का होना चाहिए (जैसे USB ड्राइव पर)।",
  "ಪಾತ್ ಸರ್ವರ್‌ನಲ್ಲಿರುವ ಒಂದು .gguf ಫೈಲ್ ಅನ್ನು ಸೂಚಿಸಬೇಕು (ಉದಾ. USB ಡ್ರೈವ್).")
P(r"This model is split into (?P<n>\d+) files but only (?P<m>\d+) are in (?P<dir>.+)\.",
  "यह मॉडल {n} फ़ाइलों में बँटा है, लेकिन {dir} में केवल {m} फ़ाइलें हैं।",
  "ಈ ಮಾದರಿ {n} ಫೈಲ್‌ಗಳಾಗಿ ವಿಭಜನೆಯಾಗಿದೆ, ಆದರೆ {dir} ನಲ್ಲಿ {m} ಫೈಲ್‌ಗಳು ಮಾತ್ರ ಇವೆ.")
P(r"Copying (?P<f>.+) did not complete \(disk full or source removed\)\.",
  "{f} की कॉपी पूरी नहीं हुई (डिस्क भर गई या स्रोत हटा दिया गया)।",
  "{f} ನಕಲು ಪೂರ್ಣಗೊಳ್ಳಲಿಲ್ಲ (ಡಿಸ್ಕ್ ತುಂಬಿದೆ ಅಥವಾ ಮೂಲ ತೆಗೆದುಹಾಕಲಾಗಿದೆ).")
M("Only models imported into the Yukti models folder can be deleted here.",
  "यहाँ से केवल वही मॉडल हटाए जा सकते हैं जो Yukti के models फ़ोल्डर में लाए गए हैं।",
  "Yukti ಮಾದರಿಗಳ (models) ಫೋಲ್ಡರ್‌ಗೆ ತಂದ ಮಾದರಿಗಳನ್ನು ಮಾತ್ರ ಇಲ್ಲಿಂದ ಅಳಿಸಬಹುದು.")
M("Unload the model first.", "पहले मॉडल को बंद (अनलोड) करें।", "ಮೊದಲು ಮಾದರಿಯನ್ನು ಅನ್‌ಲೋಡ್ ಮಾಡಿ.")
M("No logged queries yet — ask a few questions in chat first.", "अभी तक कोई सवाल दर्ज नहीं है — पहले चैट में कुछ सवाल पूछें।",
  "ಇನ್ನೂ ಯಾವುದೇ ಪ್ರಶ್ನೆ ದಾಖಲಾಗಿಲ್ಲ — ಮೊದಲು ಚಾಟ್‌ನಲ್ಲಿ ಕೆಲವು ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಿ.")
M("Load a model first.", "पहले एक मॉडल लोड करें।", "ಮೊದಲು ಒಂದು ಮಾದರಿಯನ್ನು ಲೋಡ್ ಮಾಡಿ.")
P(r"The loaded model failed during the benchmark: (?P<e>.*)", "जाँच (बेंचमार्क) के दौरान लोड किया गया मॉडल विफल हो गया: {e}",
  "ಪರೀಕ್ಷೆಯ (ಬೆಂಚ್‌ಮಾರ್ಕ್) ವೇಳೆ ಲೋಡ್ ಮಾಡಿದ ಮಾದರಿ ವಿಫಲವಾಯಿತು: {e}")
P(r"(?P<label>.+): '(?P<v>.*)' is not a valid value", "{label}: '{v}' सही मान नहीं है", "{label}: '{v}' ಸರಿಯಾದ ಮೌಲ್ಯವಲ್ಲ")
M("[hidden: this conversation used documents outside your access]",
  "[छिपाया गया: इस बातचीत में ऐसे दस्तावेज़ इस्तेमाल हुए जो आपकी पहुँच से बाहर हैं]",
  "[ಮರೆಮಾಡಲಾಗಿದೆ: ಈ ಸಂಭಾಷಣೆಯಲ್ಲಿ ನಿಮ್ಮ ಪ್ರವೇಶದ ಹೊರಗಿನ ದಾಖಲೆಗಳನ್ನು ಬಳಸಲಾಗಿದೆ]")
# role descriptions (admin → users)
M("Plant engineer / technician — asks questions, uploads documents in own scope",
  "प्लांट इंजीनियर / तकनीशियन — सवाल पूछते हैं, अपने दायरे में दस्तावेज़ जोड़ते हैं",
  "ಪ್ಲಾಂಟ್ ಎಂಜಿನಿಯರ್ / ತಂತ್ರಜ್ಞ — ಪ್ರಶ್ನೆ ಕೇಳುತ್ತಾರೆ, ತಮ್ಮ ವ್ಯಾಪ್ತಿಯಲ್ಲಿ ದಾಖಲೆಗಳನ್ನು ಸೇರಿಸುತ್ತಾರೆ")
M("Head of Department (HOD) — the only role that adds/removes documents (own department), approves access requests",
  "विभाग प्रमुख (HOD) — केवल यही भूमिका (अपने विभाग के) दस्तावेज़ जोड़/हटा सकती है और पहुँच अनुरोध मंज़ूर करती है",
  "ವಿಭಾಗದ ಮುಖ್ಯಸ್ಥರು (HOD) — (ತಮ್ಮ ವಿಭಾಗದ) ದಾಖಲೆಗಳನ್ನು ಸೇರಿಸುವ/ತೆಗೆಯುವ ಮತ್ತು ಪ್ರವೇಶ ವಿನಂತಿಗಳನ್ನು ಅನುಮೋದಿಸುವ ಏಕೈಕ ಪಾತ್ರ")
M("Plant / refinery head — approvals, escalations, audit, production view",
  "प्लांट / रिफ़ाइनरी प्रमुख — मंज़ूरी, ऊपर भेजे गए मामले, ऑडिट, उत्पादन देखना",
  "ಪ್ಲಾಂಟ್ / ರಿಫೈನರಿ ಮುಖ್ಯಸ್ಥರು — ಅನುಮೋದನೆ, ಮೇಲಕ್ಕೆ ಕಳುಹಿಸಿದ ವಿಷಯಗಳು, ಆಡಿಟ್, ಉತ್ಪಾದನೆ ವೀಕ್ಷಣೆ")
M("Production planner — production intelligence (view + edit model)",
  "उत्पादन योजनाकार — उत्पादन जानकारी (प्लांट मॉडल देखना + बदलना)",
  "ಉತ್ಪಾದನಾ ಯೋಜಕರು — ಉತ್ಪಾದನಾ ಮಾಹಿತಿ (ಪ್ಲಾಂಟ್ ಮಾದರಿ ನೋಡುವುದು + ಬದಲಿಸುವುದು)")
M("Internal auditor — read-only audit log and chain verification",
  "आंतरिक ऑडिटर — ऑडिट लॉग केवल पढ़ना और उसकी शृंखला की जाँच",
  "ಆಂತರಿಕ ಆಡಿಟರ್ — ಆಡಿಟ್ ಲಾಗ್ ಓದುವುದು ಮಾತ್ರ ಮತ್ತು ಅದರ ಸರಪಳಿ ಪರಿಶೀಲನೆ")
M("HSE officer — safety documents across units", "HSE अधिकारी — सभी यूनिटों के सुरक्षा दस्तावेज़",
  "HSE ಅಧಿಕಾರಿ — ಎಲ್ಲ ಘಟಕಗಳ ಸುರಕ್ಷತಾ ದಾಖಲೆಗಳು")
M("Process engineer — process-chemistry questions within guardrails",
  "प्रोसेस इंजीनियर — सुरक्षा नियमों के भीतर प्रोसेस-केमिस्ट्री के सवाल",
  "ಪ್ರೋಸೆಸ್ ಎಂಜಿನಿಯರ್ — ಸುರಕ್ಷತಾ ನಿಯಮಗಳ ಒಳಗೆ ಪ್ರೋಸೆಸ್-ರಸಾಯನಶಾಸ್ತ್ರದ ಪ್ರಶ್ನೆಗಳು")
M("Contract worker — minimal access, no process chemistry",
  "ठेका कर्मचारी — बहुत सीमित पहुँच, प्रोसेस केमिस्ट्री नहीं",
  "ಗುತ್ತಿಗೆ ಕಾರ್ಮಿಕರು — ಕನಿಷ್ಠ ಪ್ರವೇಶ, ಪ್ರೋಸೆಸ್ ರಸಾಯನಶಾಸ್ತ್ರ ಇಲ್ಲ")
M("Approves mechanical findings", "मैकेनिकल निष्कर्ष मंज़ूर करते हैं", "ಮೆಕ್ಯಾನಿಕಲ್ ಅವಲೋಕನಗಳನ್ನು ಅನುಮೋದಿಸುತ್ತಾರೆ")
M("Approves electrical findings", "इलेक्ट्रिकल निष्कर्ष मंज़ूर करते हैं", "ಎಲೆಕ್ಟ್ರಿಕಲ್ ಅವಲೋಕನಗಳನ್ನು ಅನುಮೋದಿಸುತ್ತಾರೆ")
M("Approves finance findings", "वित्त संबंधी निष्कर्ष मंज़ूर करते हैं", "ಹಣಕಾಸು ಅವಲೋಕನಗಳನ್ನು ಅನುಮೋದಿಸುತ್ತಾರೆ")
M("Platform administrator — users, AI settings, models, backups, usage",
  "प्लेटफ़ॉर्म व्यवस्थापक — उपयोगकर्ता, AI सेटिंग, मॉडल, बैकअप, उपयोग",
  "ಪ್ಲಾಟ್‌ಫಾರ್ಮ್ ನಿರ್ವಾಹಕರು — ಬಳಕೆದಾರರು, AI ಸೆಟ್ಟಿಂಗ್‌ಗಳು, ಮಾದರಿಗಳು, ಬ್ಯಾಕಪ್, ಬಳಕೆ")

# ============================================================== models & engines (main.py, engine.py, ollama.py)
M("Enter a server address such as http://127.0.0.1:11434 or http://gpu-server:8000/v1",
  "सर्वर का पता डालें, जैसे http://127.0.0.1:11434 या http://gpu-server:8000/v1",
  "ಸರ್ವರ್ ವಿಳಾಸ ನಮೂದಿಸಿ, ಉದಾ. http://127.0.0.1:11434 ಅಥವಾ http://gpu-server:8000/v1")
M("Choose a model to load", "लोड करने के लिए एक मॉडल चुनें", "ಲೋಡ್ ಮಾಡಲು ಒಂದು ಮಾದರಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ")
P(r"'(?P<name>.+)' is a model file; it runs on the built-in llama\.cpp engine, not (?P<eng>.+)\.",
  "'{name}' एक मॉडल फ़ाइल है; यह अंदर वाले llama.cpp इंजन पर चलती है, {eng} पर नहीं।",
  "'{name}' ಒಂದು ಮಾದರಿ ಫೈಲ್; ಇದು ಒಳಗಿನ llama.cpp ಎಂಜಿನ್‌ನಲ್ಲಿ ಓಡುತ್ತದೆ, {eng} ನಲ್ಲಿ ಅಲ್ಲ.")
M("That model file was not found. Choose a model listed under the Yukti models folder, LM Studio or the Ollama library.",
  "वह मॉडल फ़ाइल नहीं मिली। Yukti models फ़ोल्डर, LM Studio या Ollama लाइब्रेरी में दिखाया गया कोई मॉडल चुनें।",
  "ಆ ಮಾದರಿ ಫೈಲ್ ಸಿಗಲಿಲ್ಲ. Yukti models ಫೋಲ್ಡರ್, LM Studio ಅಥವಾ Ollama ಲೈಬ್ರರಿಯಲ್ಲಿ ತೋರಿಸಿರುವ ಮಾದರಿಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.")
M("Built-in presets cannot be changed. Save your changes as a new preset.",
  "पहले से बने प्रीसेट बदले नहीं जा सकते। अपने बदलाव नए प्रीसेट के रूप में सहेजें।",
  "ಮೊದಲೇ ಇರುವ ಪ್ರೀಸೆಟ್‌ಗಳನ್ನು ಬದಲಾಯಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ. ನಿಮ್ಮ ಬದಲಾವಣೆಗಳನ್ನು ಹೊಸ ಪ್ರೀಸೆಟ್ ಆಗಿ ಉಳಿಸಿ.")
M("Built-in presets cannot be deleted.", "पहले से बने प्रीसेट हटाए नहीं जा सकते।", "ಮೊದಲೇ ಇರುವ ಪ್ರೀಸೆಟ್‌ಗಳನ್ನು ಅಳಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.")
# engine names and descriptions (Admin → Models)
M("llama.cpp (Yukti-managed)", "llama.cpp (Yukti द्वारा चलाया गया)", "llama.cpp (Yukti ನಿರ್ವಹಿಸುವುದು)")
M("Yukti launches and tunes a local llama-server process with the full load configuration.",
  "Yukti इसी कंप्यूटर पर llama-server चलाता है और सभी लोड सेटिंग लागू करता है।",
  "Yukti ಇದೇ ಕಂಪ್ಯೂಟರ್‌ನಲ್ಲಿ llama-server ಅನ್ನು ಚಲಾಯಿಸಿ ಎಲ್ಲ ಲೋಡ್ ಸೆಟ್ಟಿಂಗ್‌ಗಳನ್ನು ಅನ್ವಯಿಸುತ್ತದೆ.")
M("Bionic / LM Studio server", "Bionic / LM Studio सर्वर", "Bionic / LM Studio ಸರ್ವರ್")
M("Use a model already running in Bionic's local server (OpenAI-compatible).",
  "Bionic के लोकल सर्वर में पहले से चल रहा मॉडल इस्तेमाल करें (OpenAI-संगत)।",
  "Bionic ನ ಸ್ಥಳೀಯ ಸರ್ವರ್‌ನಲ್ಲಿ ಈಗಾಗಲೇ ಓಡುತ್ತಿರುವ ಮಾದರಿಯನ್ನು ಬಳಸಿ (OpenAI-ಹೊಂದಾಣಿಕೆ).")
M("vLLM (plant GPU server)", "vLLM (प्लांट का GPU सर्वर)", "vLLM (ಪ್ಲಾಂಟ್ GPU ಸರ್ವರ್)")
M("High-throughput serving on the plant GPU server (Tier 2).", "प्लांट के GPU सर्वर पर तेज़, ज़्यादा लोगों के लिए सेवा (Tier 2)।",
  "ಪ್ಲಾಂಟ್ GPU ಸರ್ವರ್‌ನಲ್ಲಿ ವೇಗದ, ಹೆಚ್ಚು ಜನರಿಗೆ ಸೇವೆ (Tier 2).")
M("Models already downloaded in Ollama (native API: context length, GPU layers and sampling are applied).",
  "Ollama में पहले से डाउनलोड किए गए मॉडल (संदर्भ लंबाई, GPU लेयर और सैंपलिंग सेटिंग लागू होती हैं)।",
  "Ollama ನಲ್ಲಿ ಈಗಾಗಲೇ ಡೌನ್‌ಲೋಡ್ ಮಾಡಿದ ಮಾದರಿಗಳು (ಸಂದರ್ಭದ ಉದ್ದ, GPU ಲೇಯರ್‌ಗಳು ಮತ್ತು ಸ್ಯಾಂಪ್ಲಿಂಗ್ ಅನ್ವಯವಾಗುತ್ತವೆ).")
M("Custom server (OpenAI-compatible)", "अपना सर्वर (OpenAI-संगत)", "ನಿಮ್ಮದೇ ಸರ್ವರ್ (OpenAI-ಹೊಂದಾಣಿಕೆ)")
M("Any OpenAI-compatible server by URL: LM Studio, llama.cpp server, vLLM, LocalAI, Jan, text-generation-webui, or a plant GPU server.",
  "URL से कोई भी OpenAI-संगत सर्वर: LM Studio, llama.cpp server, vLLM, LocalAI, Jan, text-generation-webui, या प्लांट का GPU सर्वर।",
  "URL ಮೂಲಕ ಯಾವುದೇ OpenAI-ಹೊಂದಾಣಿಕೆಯ ಸರ್ವರ್: LM Studio, llama.cpp server, vLLM, LocalAI, Jan, text-generation-webui, ಅಥವಾ ಪ್ಲಾಂಟ್ GPU ಸರ್ವರ್.")
# engine probe problems
M("No server address set. Enter the URL the model server listens on (e.g. http://127.0.0.1:1234/v1).",
  "सर्वर का पता नहीं दिया गया है। मॉडल सर्वर का URL डालें (जैसे http://127.0.0.1:1234/v1)।",
  "ಸರ್ವರ್ ವಿಳಾಸ ನೀಡಿಲ್ಲ. ಮಾದರಿ ಸರ್ವರ್‌ನ URL ನಮೂದಿಸಿ (ಉದಾ. http://127.0.0.1:1234/v1).")
M("The server is reachable but reports no models.", "सर्वर से जुड़ाव हो गया, लेकिन उसमें कोई मॉडल नहीं है।",
  "ಸರ್ವರ್ ಸಂಪರ್ಕ ಸಿಕ್ಕಿತು, ಆದರೆ ಅದರಲ್ಲಿ ಯಾವುದೇ ಮಾದರಿ ಇಲ್ಲ.")
P(r"(?P<u>\S+) refused the request \((?P<c>\d+)\): check the API key\.",
  "{u} ने अनुरोध अस्वीकार कर दिया ({c}): API key जाँचें।", "{u} ವಿನಂತಿಯನ್ನು ನಿರಾಕರಿಸಿತು ({c}): API key ಪರಿಶೀಲಿಸಿ.")
P(r"(?P<u>\S+)/models was not found \(404\)\. OpenAI-compatible servers usually need the /v1 suffix, e\.g\. (?P<s>\S+)",
  "{u}/models नहीं मिला (404)। OpenAI-संगत सर्वर को आम तौर पर अंत में /v1 चाहिए, जैसे {s}",
  "{u}/models ಸಿಗಲಿಲ್ಲ (404). OpenAI-ಹೊಂದಾಣಿಕೆಯ ಸರ್ವರ್‌ಗಳಿಗೆ ಸಾಮಾನ್ಯವಾಗಿ ಕೊನೆಯಲ್ಲಿ /v1 ಬೇಕು, ಉದಾ. {s}")
P(r"(?P<u>\S+) answered (?P<c>\d+)\.", "{u} ने जवाब में {c} भेजा।", "{u} ಉತ್ತರವಾಗಿ {c} ಕಳುಹಿಸಿತು.")
P(r"Nothing is listening at (?P<u>\S+)\. Start the model server or correct the address\.",
  "{u} पर कोई सर्वर नहीं चल रहा है। मॉडल सर्वर चालू करें या पता ठीक करें।",
  "{u} ನಲ್ಲಿ ಯಾವುದೇ ಸರ್ವರ್ ಓಡುತ್ತಿಲ್ಲ. ಮಾದರಿ ಸರ್ವರ್ ಪ್ರಾರಂಭಿಸಿ ಅಥವಾ ವಿಳಾಸ ಸರಿಪಡಿಸಿ.")
P(r"(?P<u>\S+) did not answer within 2\.5 s\.", "{u} ने 2.5 सेकंड में जवाब नहीं दिया।", "{u} 2.5 ಸೆಕೆಂಡ್‌ನಲ್ಲಿ ಉತ್ತರಿಸಲಿಲ್ಲ.")
# Ollama
M("Ollama is running but has no models. Download one first, e.g.: ollama pull gemma3:4b",
  "Ollama चल रहा है, लेकिन उसमें कोई मॉडल नहीं है। पहले एक डाउनलोड करें, जैसे: ollama pull gemma3:4b",
  "Ollama ಓಡುತ್ತಿದೆ, ಆದರೆ ಅದರಲ್ಲಿ ಯಾವುದೇ ಮಾದರಿ ಇಲ್ಲ. ಮೊದಲು ಒಂದನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ, ಉದಾ.: ollama pull gemma3:4b")
P(r"Ollama is not running at (?P<u>\S+)\. Start the Ollama app \(or `ollama serve`\) and try again\.",
  "{u} पर Ollama नहीं चल रहा है। Ollama ऐप (या `ollama serve`) चालू करें और फिर से कोशिश करें।",
  "{u} ನಲ್ಲಿ Ollama ಓಡುತ್ತಿಲ್ಲ. Ollama ಆ್ಯಪ್ (ಅಥವಾ `ollama serve`) ಪ್ರಾರಂಭಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.")
P(r"Ollama is not running at (?P<u>\S+)\. Start the Ollama app and try again\.",
  "{u} पर Ollama नहीं चल रहा है। Ollama ऐप चालू करें और फिर से कोशिश करें।",
  "{u} ನಲ್ಲಿ Ollama ಓಡುತ್ತಿಲ್ಲ. Ollama ಆ್ಯಪ್ ಪ್ರಾರಂಭಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.")
P(r"Ollama is not running at (?P<u>\S+)\.", "{u} पर Ollama नहीं चल रहा है।", "{u} ನಲ್ಲಿ Ollama ಓಡುತ್ತಿಲ್ಲ.")
P(r"Could not reach Ollama at (?P<u>\S+): (?P<e>.*)", "{u} पर Ollama से जुड़ नहीं सके: {e}", "{u} ನಲ್ಲಿ Ollama ಸಂಪರ್ಕಿಸಲಾಗಲಿಲ್ಲ: {e}")
P(r"Could not reach Ollama: (?P<e>.*)", "Ollama से जुड़ नहीं सके: {e}", "Ollama ಸಂಪರ್ಕಿಸಲಾಗಲಿಲ್ಲ: {e}")
P(r"Ollama has no model named '(?P<m>.+)'\. Download it first: ollama pull (?P<m2>\S+)",
  "Ollama में '{m}' नाम का कोई मॉडल नहीं है। पहले इसे डाउनलोड करें: ollama pull {m2}",
  "Ollama ನಲ್ಲಿ '{m}' ಹೆಸರಿನ ಮಾದರಿ ಇಲ್ಲ. ಮೊದಲು ಅದನ್ನು ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ: ollama pull {m2}")
P(r"Ollama did not finish loading (?P<m>\S+): (?P<e>.*)", "Ollama {m} को पूरा लोड नहीं कर पाया: {e}",
  "Ollama {m} ಅನ್ನು ಪೂರ್ತಿ ಲೋಡ್ ಮಾಡಲಿಲ್ಲ: {e}")
P(r"Ollama could not load (?P<m>\S+): (?P<e>.*)", "Ollama {m} को लोड नहीं कर सका: {e}", "Ollama {m} ಅನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ: {e}")
P(r"Ollama returned (?P<c>\d+): (?P<t>.*)", "Ollama ने त्रुटि {c} लौटाई: {t}", "Ollama ದೋಷ {c} ಹಿಂತಿರುಗಿಸಿತು: {t}")
# model loading / watchdog / diagnosis
M("Model file not found", "मॉडल फ़ाइल नहीं मिली", "ಮಾದರಿ ಫೈಲ್ ಸಿಗಲಿಲ್ಲ")
P(r"(?P<n>.+) is not reachable at (?P<u>\S+)", "{u} पर {n} से जुड़ नहीं सके", "{u} ನಲ್ಲಿ {n} ಸಂಪರ್ಕಿಸಲಾಗಲಿಲ್ಲ")
P(r"(?P<u>\S+) has no model '(?P<m>.+)'\. Available: (?P<l>.*)", "{u} पर '{m}' मॉडल नहीं है। उपलब्ध: {l}",
  "{u} ನಲ್ಲಿ '{m}' ಮಾದರಿ ಇಲ್ಲ. ಲಭ್ಯವಿರುವುದು: {l}")
P(r"This llama\.cpp build does not support the model architecture '(?P<a>.+)'\. Use a model in a supported architecture, "
  r"or run it through Ollama / LM Studio and connect that engine\.",
  "यह llama.cpp संस्करण '{a}' प्रकार के मॉडल को नहीं चला सकता। समर्थित प्रकार का मॉडल लें, या इसे Ollama / LM Studio में चलाकर वह इंजन जोड़ें।",
  "ಈ llama.cpp ಆವೃತ್ತಿ '{a}' ರಚನೆಯ ಮಾದರಿಯನ್ನು ಚಲಾಯಿಸಲಾರದು. ಬೆಂಬಲಿತ ರಚನೆಯ ಮಾದರಿ ಬಳಸಿ, ಅಥವಾ ಅದನ್ನು Ollama / LM Studio ನಲ್ಲಿ ಚಲಾಯಿಸಿ ಆ ಎಂಜಿನ್ ಸಂಪರ್ಕಿಸಿ.")
M("The model file is not a valid GGUF (corrupt or incomplete download). Download or copy it again.",
  "मॉडल फ़ाइल सही GGUF नहीं है (खराब या अधूरा डाउनलोड)। इसे फिर से डाउनलोड या कॉपी करें।",
  "ಮಾದರಿ ಫೈಲ್ ಸರಿಯಾದ GGUF ಅಲ್ಲ (ಹಾಳಾದ ಅಥವಾ ಅಪೂರ್ಣ ಡೌನ್‌ಲೋಡ್). ಅದನ್ನು ಮತ್ತೆ ಡೌನ್‌ಲೋಡ್ ಅಥವಾ ನಕಲು ಮಾಡಿ.")
M("This model file was written in a variant (typically by Ollama) that the built-in llama.cpp cannot read. "
  "Choose the same model under the Ollama engine instead (Ollama must be running), or use a standard GGUF.",
  "यह मॉडल फ़ाइल ऐसे रूप में है (आम तौर पर Ollama की) जिसे अंदर वाला llama.cpp नहीं पढ़ सकता। "
  "यही मॉडल Ollama इंजन में चुनें (Ollama चालू होना चाहिए), या सामान्य GGUF इस्तेमाल करें।",
  "ಈ ಮಾದರಿ ಫೈಲ್ ಒಳಗಿನ llama.cpp ಓದಲಾಗದ ರೂಪದಲ್ಲಿದೆ (ಸಾಮಾನ್ಯವಾಗಿ Ollama ದು). "
  "ಇದೇ ಮಾದರಿಯನ್ನು Ollama ಎಂಜಿನ್‌ನಲ್ಲಿ ಆಯ್ಕೆಮಾಡಿ (Ollama ಓಡುತ್ತಿರಬೇಕು), ಅಥವಾ ಸಾಮಾನ್ಯ GGUF ಬಳಸಿ.")
M("The model file contains tensors this llama.cpp build cannot read (for example Ollama's combined vision "
  "models). Load it through the Ollama engine instead, or use a plain GGUF of the same model.",
  "मॉडल फ़ाइल में ऐसे हिस्से (tensors) हैं जिन्हें यह llama.cpp नहीं पढ़ सकता (जैसे Ollama के विज़न वाले मॉडल)। "
  "इसे Ollama इंजन से लोड करें, या इसी मॉडल की सामान्य GGUF फ़ाइल लें।",
  "ಮಾದರಿ ಫೈಲ್‌ನಲ್ಲಿ ಈ llama.cpp ಓದಲಾಗದ ಭಾಗಗಳು (tensors) ಇವೆ (ಉದಾ. Ollama ದ ದೃಶ್ಯ ಸಹಿತ ಮಾದರಿಗಳು). "
  "ಇದನ್ನು Ollama ಎಂಜಿನ್ ಮೂಲಕ ಲೋಡ್ ಮಾಡಿ, ಅಥವಾ ಇದೇ ಮಾದರಿಯ ಸಾಮಾನ್ಯ GGUF ಬಳಸಿ.")
M("Not enough GPU/CPU memory for this model with these settings. Lower Context length or GPU offload layers, "
  "or use a smaller / more quantized model.",
  "इन सेटिंग के साथ इस मॉडल के लिए GPU/CPU मेमोरी काफ़ी नहीं है। संदर्भ लंबाई (Context length) या GPU लेयर कम करें, "
  "या छोटा / ज़्यादा संकुचित (quantized) मॉडल लें।",
  "ಈ ಸೆಟ್ಟಿಂಗ್‌ಗಳೊಂದಿಗೆ ಈ ಮಾದರಿಗೆ GPU/CPU ಮೆಮೊರಿ ಸಾಕಾಗುತ್ತಿಲ್ಲ. ಸಂದರ್ಭದ ಉದ್ದ (Context length) ಅಥವಾ GPU ಲೇಯರ್‌ಗಳನ್ನು ಕಡಿಮೆ ಮಾಡಿ, "
  "ಅಥವಾ ಚಿಕ್ಕ / ಹೆಚ್ಚು ಕುಗ್ಗಿಸಿದ (quantized) ಮಾದರಿ ಬಳಸಿ.")
M("The model file could not be opened. Check that it still exists and that the path is accessible.",
  "मॉडल फ़ाइल खुल नहीं सकी। जाँचें कि फ़ाइल अभी भी मौजूद है और उसका पाथ खुल सकता है।",
  "ಮಾದರಿ ಫೈಲ್ ತೆರೆಯಲಾಗಲಿಲ್ಲ. ಫೈಲ್ ಇನ್ನೂ ಇದೆಯೇ ಮತ್ತು ಪಾತ್ ತೆರೆಯಬಹುದೇ ಎಂದು ಪರಿಶೀಲಿಸಿ.")
P(r"llama-server rejected a load setting: (?P<x>.*)", "llama-server ने एक लोड सेटिंग अस्वीकार कर दी: {x}",
  "llama-server ಒಂದು ಲೋಡ್ ಸೆಟ್ಟಿಂಗ್ ಅನ್ನು ತಿರಸ್ಕರಿಸಿತು: {x}")
M("llama-server stopped while loading. See Admin → Developer → Logs for its output.",
  "लोड होते समय llama-server रुक गया। इसका आउटपुट Admin → Developer → Logs में देखें।",
  "ಲೋಡ್ ಆಗುವಾಗ llama-server ನಿಂತುಹೋಯಿತು. ಅದರ ಔಟ್‌ಪುಟ್ ಅನ್ನು Admin → Developer → Logs ನಲ್ಲಿ ನೋಡಿ.")
P(r"llama-server stopped while loading: (?P<x>.*)", "लोड होते समय llama-server रुक गया: {x}", "ಲೋಡ್ ಆಗುವಾಗ llama-server ನಿಂತುಹೋಯಿತು: {x}")
P(r"llama-server crashed \(exit code (?P<c>-?\d+)\) (?P<n>\d+) times in (?P<m>\d+) min; automatic restart stopped\. "
  r"Check Developer logs, reduce context/GPU layers, then reload the model\.",
  "llama-server {m} मिनट में {n} बार बंद हो गया (exit code {c}); अपने-आप फिर से चालू करना रोक दिया गया है। "
  "Developer लॉग देखें, संदर्भ/GPU लेयर कम करें, फिर मॉडल दोबारा लोड करें।",
  "llama-server {m} ನಿಮಿಷದಲ್ಲಿ {n} ಬಾರಿ ನಿಂತುಹೋಯಿತು (exit code {c}); ತಾನಾಗಿ ಮರುಪ್ರಾರಂಭ ನಿಲ್ಲಿಸಲಾಗಿದೆ. "
  "Developer ಲಾಗ್ ನೋಡಿ, ಸಂದರ್ಭ/GPU ಲೇಯರ್‌ಗಳನ್ನು ಕಡಿಮೆ ಮಾಡಿ, ನಂತರ ಮಾದರಿಯನ್ನು ಮತ್ತೆ ಲೋಡ್ ಮಾಡಿ.")
P(r"llama-server stopped unexpectedly \(exit code (?P<c>-?\d+)\); restarting automatically",
  "llama-server अचानक रुक गया (exit code {c}); अपने-आप फिर से चालू हो रहा है",
  "llama-server ಅನಿರೀಕ್ಷಿತವಾಗಿ ನಿಂತಿತು (exit code {c}); ತಾನಾಗಿ ಮರುಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ")
P(r"Automatic restart failed: (?P<e>.*)", "अपने-आप फिर से चालू करना विफल रहा: {e}", "ತಾನಾಗಿ ಮರುಪ್ರಾರಂಭ ವಿಫಲವಾಯಿತು: {e}")
P(r"llama-server did not become ready within 30 minutes and was stopped\. (?P<t_m>.*)",
  "llama-server 30 मिनट में तैयार नहीं हुआ और उसे रोक दिया गया। {t_m}",
  "llama-server 30 ನಿಮಿಷಗಳಲ್ಲಿ ಸಿದ್ಧವಾಗಲಿಲ್ಲ, ಅದನ್ನು ನಿಲ್ಲಿಸಲಾಯಿತು. {t_m}")

# ============================================================== chat (chat.py, engine.py)
M("No model is loaded. An administrator must load one (Admin -> Models).",
  "अभी कोई AI मॉडल लोड नहीं है। व्यवस्थापक को एक मॉडल लोड करना होगा (Admin -> Models)।",
  "ಈಗ ಯಾವುದೇ AI ಮಾದರಿ ಲೋಡ್ ಆಗಿಲ್ಲ. ನಿರ್ವಾಹಕರು ಒಂದು ಮಾದರಿಯನ್ನು ಲೋಡ್ ಮಾಡಬೇಕು (Admin -> Models).")
M("This conversation plus the retrieved documents is longer than the model's context window. "
  "Start a new chat, or ask the administrator to raise Context length when loading the model.",
  "यह बातचीत और मिले दस्तावेज़ मिलकर मॉडल की याद रखने की सीमा से लंबे हैं। "
  "नई चैट शुरू करें, या व्यवस्थापक से मॉडल लोड करते समय संदर्भ लंबाई (Context length) बढ़ाने को कहें।",
  "ಈ ಸಂಭಾಷಣೆ ಮತ್ತು ಸಿಕ್ಕ ದಾಖಲೆಗಳು ಸೇರಿ ಮಾದರಿಯ ನೆನಪಿನ ಮಿತಿಗಿಂತ ಉದ್ದವಾಗಿವೆ. "
  "ಹೊಸ ಚಾಟ್ ಪ್ರಾರಂಭಿಸಿ, ಅಥವಾ ಮಾದರಿ ಲೋಡ್ ಮಾಡುವಾಗ ಸಂದರ್ಭದ ಉದ್ದ (Context length) ಹೆಚ್ಚಿಸಲು ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.")
M("The answer was interrupted by a server error. Please try again.",
  "सर्वर में गड़बड़ी से जवाब बीच में रुक गया। कृपया फिर से कोशिश करें।",
  "ಸರ್ವರ್ ದೋಷದಿಂದ ಉತ್ತರ ಅರ್ಧದಲ್ಲೇ ನಿಂತಿತು. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.")
P(r"The model was restarted or switched while answering\. Please press Regenerate\. \((?P<t_m>.*)\)",
  "जवाब देते समय मॉडल फिर से चालू हुआ या बदल गया। कृपया Regenerate (फिर से बनाएँ) दबाएँ। ({t_m})",
  "ಉತ್ತರಿಸುವಾಗ ಮಾದರಿ ಮರುಪ್ರಾರಂಭವಾಯಿತು ಅಥವಾ ಬದಲಾಯಿತು. ದಯವಿಟ್ಟು Regenerate (ಮತ್ತೆ ರಚಿಸಿ) ಒತ್ತಿ. ({t_m})")
P(r"Engine returned (?P<c>\d+): (?P<t>.*)", "AI इंजन ने त्रुटि {c} लौटाई: {t}", "AI ಎಂಜಿನ್ ದೋಷ {c} ಹಿಂತಿರುಗಿಸಿತು: {t}")
P(r"Could not reach the engine: (?P<e>.*)", "AI इंजन से जुड़ नहीं सके: {e}", "AI ಎಂಜಿನ್ ಸಂಪರ್ಕಿಸಲಾಗಲಿಲ್ಲ: {e}")
P(r"Could not reach (?P<u>\S+): (?P<e>.*)", "{u} से जुड़ नहीं सके: {e}", "{u} ಸಂಪರ್ಕಿಸಲಾಗಲಿಲ್ಲ: {e}")
M("Chat not found", "चैट नहीं मिली", "ಚಾಟ್ ಸಿಗಲಿಲ್ಲ")
M("Nothing to regenerate", "फिर से बनाने के लिए कुछ नहीं है", "ಮತ್ತೆ ರಚಿಸಲು ಏನೂ ಇಲ್ಲ")
M("Enter a folder name", "फ़ोल्डर का नाम डालें", "ಫೋಲ್ಡರ್ ಹೆಸರು ನಮೂದಿಸಿ")
M("Folder not found", "फ़ोल्डर नहीं मिला", "ಫೋಲ್ಡರ್ ಸಿಗಲಿಲ್ಲ")
M("Project not found", "फ़ोल्डर नहीं मिला", "ಫೋಲ್ಡರ್ ಸಿಗಲಿಲ್ಲ")
M("Message not found", "संदेश नहीं मिला", "ಸಂದೇಶ ಸಿಗಲಿಲ್ಲ")
M("Document no longer available to you", "यह दस्तावेज़ अब आपके लिए उपलब्ध नहीं है", "ಈ ದಾಖಲೆ ಈಗ ನಿಮಗೆ ಲಭ್ಯವಿಲ್ಲ")
# company guardrails: refusals shown as the answer, and policy reasons (policies/core.yaml)
M("I can't help with that. It is outside plant operations and is blocked by the company guardrail (G-OFF-DOMAIN-HARM).",
  "मैं इसमें मदद नहीं कर सकता। यह प्लांट के काम से बाहर है और कंपनी के सुरक्षा नियम (G-OFF-DOMAIN-HARM) से रोका गया है।",
  "ಇದಕ್ಕೆ ನಾನು ಸಹಾಯ ಮಾಡಲಾರೆ. ಇದು ಪ್ಲಾಂಟ್ ಕೆಲಸದ ಹೊರಗಿನದು ಮತ್ತು ಕಂಪನಿಯ ಸುರಕ್ಷತಾ ನಿಯಮದಿಂದ (G-OFF-DOMAIN-HARM) ತಡೆಯಲಾಗಿದೆ.")
M("Yukti is advisory only and never changes setpoints, interlocks or control logic (company guardrail G-CONTROL-CHANGE). "
  "Please raise a Management-of-Change request with Operations / the control-room shift in-charge.",
  "Yukti केवल सलाह देता है; यह कभी भी सेटपॉइंट, इंटरलॉक या कंट्रोल लॉजिक नहीं बदलता (कंपनी सुरक्षा नियम G-CONTROL-CHANGE)। "
  "कृपया ऑपरेशंस / कंट्रोल-रूम शिफ़्ट प्रभारी के पास Management-of-Change (MOC) अनुरोध दें।",
  "Yukti ಸಲಹೆ ಮಾತ್ರ ನೀಡುತ್ತದೆ; ಅದು ಎಂದಿಗೂ ಸೆಟ್‌ಪಾಯಿಂಟ್, ಇಂಟರ್‌ಲಾಕ್ ಅಥವಾ ಕಂಟ್ರೋಲ್ ಲಾಜಿಕ್ ಬದಲಾಯಿಸುವುದಿಲ್ಲ (ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ G-CONTROL-CHANGE). "
  "ದಯವಿಟ್ಟು ಆಪರೇಷನ್ಸ್ / ಕಂಟ್ರೋಲ್-ರೂಮ್ ಶಿಫ್ಟ್ ಉಸ್ತುವಾರಿಯವರಿಗೆ Management-of-Change (MOC) ವಿನಂತಿ ಸಲ್ಲಿಸಿ.")
P(r"This request is blocked by company guardrail (?P<ids>[^:]+): (?P<t_reason>.+)",
  "यह अनुरोध कंपनी सुरक्षा नियम {ids} से रोका गया है: {t_reason}",
  "ಈ ವಿನಂತಿಯನ್ನು ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ {ids} ತಡೆದಿದೆ: {t_reason}")
M("Yukti is advisory only: no DCS/SCADA writes exist.", "Yukti केवल सलाह देता है: DCS/SCADA में कुछ भी लिखने की सुविधा है ही नहीं।",
  "Yukti ಸಲಹೆ ಮಾತ್ರ ನೀಡುತ್ತದೆ: DCS/SCADA ಗೆ ಏನನ್ನೂ ಬರೆಯುವ ಸೌಲಭ್ಯವೇ ಇಲ್ಲ.")
M("Company guardrail: requests outside plant operations that could enable harm are always refused.",
  "कंपनी सुरक्षा नियम: प्लांट के काम से बाहर के ऐसे अनुरोध जो नुकसान पहुँचा सकते हैं, हमेशा मना किए जाते हैं।",
  "ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ: ಹಾನಿ ಮಾಡಬಹುದಾದ, ಪ್ಲಾಂಟ್ ಕೆಲಸದ ಹೊರಗಿನ ವಿನಂತಿಗಳನ್ನು ಯಾವಾಗಲೂ ನಿರಾಕರಿಸಲಾಗುತ್ತದೆ.")
M("Company guardrail: Yukti never changes setpoints or control logic; raise an MOC via operations.",
  "कंपनी सुरक्षा नियम: Yukti कभी सेटपॉइंट या कंट्रोल लॉजिक नहीं बदलता; ऑपरेशंस के ज़रिए MOC अनुरोध दें।",
  "ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ: Yukti ಎಂದಿಗೂ ಸೆಟ್‌ಪಾಯಿಂಟ್ ಅಥವಾ ಕಂಟ್ರೋಲ್ ಲಾಜಿಕ್ ಬದಲಾಯಿಸುವುದಿಲ್ಲ; ಆಪರೇಷನ್ಸ್ ಮೂಲಕ MOC ಸಲ್ಲಿಸಿ.")
M("Document classification is above your clearance.", "यह दस्तावेज़ आपके अनुमति स्तर से ऊँचे वर्गीकरण का है।",
  "ಈ ದಾಖಲೆಯ ವರ್ಗೀಕರಣ ನಿಮ್ಮ ಅನುಮತಿ ಮಟ್ಟಕ್ಕಿಂತ ಹೆಚ್ಚಿನದು.")
M("Finance records are restricted to Finance & Accounts, Internal Audit and the MD Office.",
  "वित्त रिकॉर्ड केवल वित्त एवं लेखा, आंतरिक ऑडिट और MD कार्यालय के लिए हैं।",
  "ಹಣಕಾಸು ದಾಖಲೆಗಳು ಹಣಕಾಸು ಮತ್ತು ಲೆಕ್ಕಪತ್ರ, ಆಂತರಿಕ ಆಡಿಟ್ ಮತ್ತು MD ಕಚೇರಿಗೆ ಮಾತ್ರ.")
M("Company guardrail: contractors may not receive process-chemistry details; request access via HSE.",
  "कंपनी सुरक्षा नियम: ठेका कर्मचारियों को प्रोसेस-केमिस्ट्री की जानकारी नहीं दी जाती; पहुँच के लिए HSE से अनुरोध करें।",
  "ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ: ಗುತ್ತಿಗೆ ಕಾರ್ಮಿಕರಿಗೆ ಪ್ರೋಸೆಸ್-ರಸಾಯನಶಾಸ್ತ್ರದ ವಿವರ ನೀಡಲಾಗುವುದಿಲ್ಲ; ಪ್ರವೇಶಕ್ಕಾಗಿ HSE ಮೂಲಕ ವಿನಂತಿಸಿ.")
M("Company guardrail: proprietary formulations need CONFIDENTIAL clearance or a time-bound grant.",
  "कंपनी सुरक्षा नियम: कंपनी के गोपनीय फ़ॉर्मूलेशन के लिए CONFIDENTIAL अनुमति स्तर या समय-सीमित अनुमति चाहिए।",
  "ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮ: ಕಂಪನಿಯ ಗೋಪ್ಯ ಸೂತ್ರಗಳಿಗೆ CONFIDENTIAL ಅನುಮತಿ ಮಟ್ಟ ಅಥವಾ ಸಮಯ-ಮಿತಿಯ ಅನುಮತಿ ಬೇಕು.")
M("allowed", "अनुमति है", "ಅನುಮತಿ ಇದೆ")
M("no rule allows this", "कोई नियम इसकी अनुमति नहीं देता", "ಯಾವುದೇ ನಿಯಮ ಇದಕ್ಕೆ ಅನುಮತಿ ನೀಡುವುದಿಲ್ಲ")
M("base model + Company Guardrails (Heretic domain model: planned)",
  "मूल मॉडल + कंपनी सुरक्षा नियम (Heretic डोमेन मॉडल: योजना में)",
  "ಮೂಲ ಮಾದರಿ + ಕಂಪನಿ ಸುರಕ್ಷತಾ ನಿಯಮಗಳು (Heretic ಡೊಮೇನ್ ಮಾದರಿ: ಯೋಜನೆಯಲ್ಲಿ)")
# fact notes (dossier and public facts)
M("Public sources disagree — values differ by source/basis; cite the source when quoting.",
  "सार्वजनिक स्रोतों में अंतर है — स्रोत/आधार के अनुसार मान अलग हैं; बताते समय स्रोत का नाम दें।",
  "ಸಾರ್ವಜನಿಕ ಮೂಲಗಳಲ್ಲಿ ವ್ಯತ್ಯಾಸವಿದೆ — ಮೂಲ/ಆಧಾರದ ಪ್ರಕಾರ ಮೌಲ್ಯಗಳು ಬೇರೆ; ಉಲ್ಲೇಖಿಸುವಾಗ ಮೂಲವನ್ನು ತಿಳಿಸಿ.")
M("Public source", "सार्वजनिक स्रोत", "ಸಾರ್ವಜನಿಕ ಮೂಲ")
M("CMMS work orders", "CMMS वर्क ऑर्डर", "CMMS ಕೆಲಸದ ಆದೇಶಗಳು (work orders)")
P(r"No authorised source holds '(?P<a>.+)'\. Expected in: wiring diagram / asset master\.",
  "'{a}' किसी भी अनुमत स्रोत में नहीं है। यह वायरिंग डायग्राम / एसेट मास्टर में होना चाहिए।",
  "'{a}' ಯಾವುದೇ ಅನುಮತಿಸಿದ ಮೂಲದಲ್ಲಿ ಇಲ್ಲ. ಇದು ವೈರಿಂಗ್ ಡಯಾಗ್ರಾಮ್ / ಆಸ್ತಿ ಮಾಸ್ಟರ್‌ನಲ್ಲಿ ಇರಬೇಕು.")
P(r"No authorised source holds '(?P<a>.+)'\. Expected in: (?P<n>.+)\. (?P<k>\d+) source\(s\) outside your access may hold it; you can request access\.",
  "'{a}' किसी भी अनुमत स्रोत में नहीं है। यह {n} में होना चाहिए। आपकी पहुँच से बाहर के {k} स्रोतों में यह हो सकता है; आप पहुँच का अनुरोध कर सकते हैं।",
  "'{a}' ಯಾವುದೇ ಅನುಮತಿಸಿದ ಮೂಲದಲ್ಲಿ ಇಲ್ಲ. ಇದು {n} ನಲ್ಲಿ ಇರಬೇಕು. ನಿಮ್ಮ ಪ್ರವೇಶದ ಹೊರಗಿನ {k} ಮೂಲಗಳಲ್ಲಿ ಇದು ಇರಬಹುದು; ನೀವು ಪ್ರವೇಶಕ್ಕೆ ವಿನಂತಿಸಬಹುದು.")
P(r"No authorised source holds '(?P<a>.+)'\. Expected in: (?P<n>.+)\.",
  "'{a}' किसी भी अनुमत स्रोत में नहीं है। यह {n} में होना चाहिए।",
  "'{a}' ಯಾವುದೇ ಅನುಮತಿಸಿದ ಮೂಲದಲ್ಲಿ ಇಲ್ಲ. ಇದು {n} ನಲ್ಲಿ ಇರಬೇಕು.")
P(r"No authorised source holds '(?P<a>.+)'\. (?P<k>\d+) source\(s\) outside your access may hold it; you can request access\.",
  "'{a}' किसी भी अनुमत स्रोत में नहीं है। आपकी पहुँच से बाहर के {k} स्रोतों में यह हो सकता है; आप पहुँच का अनुरोध कर सकते हैं।",
  "'{a}' ಯಾವುದೇ ಅನುಮತಿಸಿದ ಮೂಲದಲ್ಲಿ ಇಲ್ಲ. ನಿಮ್ಮ ಪ್ರವೇಶದ ಹೊರಗಿನ {k} ಮೂಲಗಳಲ್ಲಿ ಇದು ಇರಬಹುದು; ನೀವು ಪ್ರವೇಶಕ್ಕೆ ವಿನಂತಿಸಬಹುದು.")
P(r"No authorised source holds '(?P<a>.+)'\.", "'{a}' किसी भी अनुमत स्रोत में नहीं है।", "'{a}' ಯಾವುದೇ ಅನುಮತಿಸಿದ ಮೂಲದಲ್ಲಿ ಇಲ್ಲ.")
P(r"Sources disagree\. Recommended: (?P<src>.+) rev (?P<rev>.*) \(latest CURRENT revision of the highest-priority source\)\. "
  r"Verify in field before acting\.",
  "स्रोतों में अंतर है। सुझाया गया: {src} rev {rev} (सबसे ज़रूरी स्रोत का नवीनतम CURRENT संस्करण)। काम करने से पहले मौके पर जाँच करें।",
  "ಮೂಲಗಳಲ್ಲಿ ವ್ಯತ್ಯಾಸವಿದೆ. ಶಿಫಾರಸು: {src} rev {rev} (ಅತ್ಯಂತ ಮುಖ್ಯ ಮೂಲದ ಇತ್ತೀಚಿನ CURRENT ಆವೃತ್ತಿ). ಕೆಲಸ ಮಾಡುವ ಮೊದಲು ಸ್ಥಳದಲ್ಲೇ ಪರಿಶೀಲಿಸಿ.")

# ============================================================== documents & ingestion (main.py, rag.py)
P(r"'(?P<ext>.+)' files cannot be indexed\. Supported: (?P<l>.+)",
  "'{ext}' फ़ाइलें Knowledge में नहीं जोड़ी जा सकतीं। ये चलती हैं: {l}",
  "'{ext}' ಫೈಲ್‌ಗಳನ್ನು Knowledge ಗೆ ಸೇರಿಸಲಾಗದು. ಬೆಂಬಲಿತ: {l}")
M("Max 50 MB", "अधिकतम 50 MB", "ಗರಿಷ್ಠ 50 MB")
M("You cannot upload above your own clearance.", "आप अपने अनुमति स्तर से ऊँचे वर्गीकरण का दस्तावेज़ अपलोड नहीं कर सकते।",
  "ನಿಮ್ಮ ಅನುಮತಿ ಮಟ್ಟಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ವರ್ಗೀಕರಣದ ದಾಖಲೆಯನ್ನು ಅಪ್‌ಲೋಡ್ ಮಾಡಲಾಗದು.")
P(r"Unknown document type '(?P<t>.*)'\.", "यह दस्तावेज़ प्रकार मौजूद नहीं है: '{t}'।", "ಈ ದಾಖಲೆ ಪ್ರಕಾರ ಇಲ್ಲ: '{t}'.")
P(r"(?P<t>.+) documents are shared plant-wide and can be added only by the (?P<office>.+) office\.",
  "{t} दस्तावेज़ पूरे प्लांट के लिए साझा हैं और केवल {office} कार्यालय ही इन्हें जोड़ सकता है।",
  "{t} ದಾಖಲೆಗಳು ಇಡೀ ಪ್ಲಾಂಟ್‌ಗೆ ಹಂಚಿಕೆಯಾಗಿವೆ, ಅವುಗಳನ್ನು {office} ಕಚೇರಿ ಮಾತ್ರ ಸೇರಿಸಬಹುದು.")
P(r"This exact file is already in Knowledge as “(?P<title>.*)”\.", "यही फ़ाइल पहले से Knowledge में “{title}” नाम से है।",
  "ಇದೇ ಫೈಲ್ ಈಗಾಗಲೇ Knowledge ನಲ್ಲಿ “{title}” ಹೆಸರಿನಲ್ಲಿ ಇದೆ.")
P(r"Document number (?P<n>.+) belongs to another department\.", "दस्तावेज़ संख्या {n} किसी दूसरे विभाग की है।",
  "ದಾಖಲೆ ಸಂಖ್ಯೆ {n} ಬೇರೆ ವಿಭಾಗಕ್ಕೆ ಸೇರಿದೆ.")
M("Job not found", "काम (जॉब) नहीं मिला", "ಕೆಲಸ (ಜಾಬ್) ಸಿಗಲಿಲ್ಲ")
M("Document not found", "दस्तावेज़ नहीं मिला", "ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ")
M("HODs can remove only their own department's documents.", "HOD केवल अपने विभाग के दस्तावेज़ हटा सकते हैं।",
  "HOD ಗಳು ತಮ್ಮ ವಿಭಾಗದ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ತೆಗೆದುಹಾಕಬಹುದು.")
M("Interrupted by a server restart - upload the file again.", "सर्वर फिर से चालू होने से काम रुक गया - फ़ाइल फिर से अपलोड करें।",
  "ಸರ್ವರ್ ಮರುಪ್ರಾರಂಭದಿಂದ ಕೆಲಸ ನಿಂತಿತು - ಫೈಲ್ ಅನ್ನು ಮತ್ತೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ.")
M("No readable text was found in this file (empty, image-only with unreadable scan, or a "
  "spreadsheet without data rows). It is stored but cannot be searched or cited.",
  "इस फ़ाइल में पढ़ने लायक कोई लिखावट नहीं मिली (खाली, पढ़ने में न आने वाला स्कैन, या बिना डेटा वाली स्प्रेडशीट)। "
  "फ़ाइल रख ली गई है, पर इसमें खोज या इसका हवाला नहीं दिया जा सकता।",
  "ಈ ಫೈಲ್‌ನಲ್ಲಿ ಓದಬಹುದಾದ ಪಠ್ಯ ಸಿಗಲಿಲ್ಲ (ಖಾಲಿ, ಓದಲಾಗದ ಸ್ಕ್ಯಾನ್, ಅಥವಾ ಡೇಟಾ ಸಾಲುಗಳಿಲ್ಲದ ಸ್ಪ್ರೆಡ್‌ಶೀಟ್). "
  "ಫೈಲ್ ಉಳಿಸಲಾಗಿದೆ, ಆದರೆ ಇದರಲ್ಲಿ ಹುಡುಕಲು ಅಥವಾ ಉಲ್ಲೇಖಿಸಲು ಸಾಧ್ಯವಿಲ್ಲ.")
P(r"Unsupported file type '(?P<e>.*)'\. Supported: (?P<l>.+)", "यह फ़ाइल प्रकार नहीं चलता: '{e}'। ये चलते हैं: {l}",
  "ಈ ಫೈಲ್ ಪ್ರಕಾರ ಬೆಂಬಲಿತವಲ್ಲ: '{e}'. ಬೆಂಬಲಿತ: {l}")
# ingestion job stages (Knowledge → upload progress)
M("Store & fingerprint", "सहेजना और पहचान-चिह्न", "ಉಳಿಸುವುದು ಮತ್ತು ಗುರುತು (fingerprint)")
M("Detect type & page modes", "फ़ाइल प्रकार और पेज की जाँच", "ಫೈಲ್ ಪ್ರಕಾರ ಮತ್ತು ಪುಟಗಳ ಪರಿಶೀಲನೆ")
M("Extract text / OCR", "लिखावट निकालना / OCR", "ಪಠ್ಯ ತೆಗೆಯುವುದು / OCR")
M("Tag assets", "उपकरण टैग पहचानना", "ಉಪಕರಣ ಟ್ಯಾಗ್ ಗುರುತಿಸುವುದು")
M("Chunk", "छोटे हिस्सों में बाँटना", "ಸಣ್ಣ ಭಾಗಗಳಾಗಿ ವಿಭಜಿಸುವುದು")
M("Index (BM25)", "खोज सूची बनाना (BM25)", "ಹುಡುಕಾಟ ಸೂಚಿ ರಚನೆ (BM25)")
P(r"sha256 (?P<h>\S+) · (?P<k>\d+) KB", "sha256 {h} · {k} KB", "sha256 {h} · {k} KB")
P(r"PDF · (?P<n>\d+) page\(s\): (?P<d>\d+) digital, (?P<s>\d+) scanned", "PDF · {n} पेज: {d} डिजिटल, {s} स्कैन किए हुए",
  "PDF · {n} ಪುಟ(ಗಳು): {d} ಡಿಜಿಟಲ್, {s} ಸ್ಕ್ಯಾನ್ ಮಾಡಿದವು")
M("OCR on scanned pages", "स्कैन किए पेजों पर OCR", "ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪುಟಗಳ ಮೇಲೆ OCR")
M("Reading text layer", "फ़ाइल की लिखावट पढ़ी जा रही है", "ಫೈಲ್‌ನ ಪಠ್ಯವನ್ನು ಓದಲಾಗುತ್ತಿದೆ")
P(r"OCR \(RapidOCR PP-OCR ONNX\) on (?P<n>\d+) page\(s\)", "{n} पेज पर OCR (RapidOCR PP-OCR ONNX)",
  "{n} ಪುಟ(ಗಳ) ಮೇಲೆ OCR (RapidOCR PP-OCR ONNX)")
M("Text layer extracted — no OCR needed", "लिखावट निकाल ली गई — OCR की ज़रूरत नहीं", "ಪಠ್ಯ ತೆಗೆಯಲಾಗಿದೆ — OCR ಬೇಕಿಲ್ಲ")
M("Image · treated as a scanned page", "चित्र · स्कैन किए पेज की तरह पढ़ा गया", "ಚಿತ್ರ · ಸ್ಕ್ಯಾನ್ ಮಾಡಿದ ಪುಟದಂತೆ ಓದಲಾಗಿದೆ")
P(r"OCR on (?P<n>\d+) page\(s\), mean confidence (?P<c>[\d.]+)", "{n} पेज पर OCR, औसत भरोसा {c}",
  "{n} ಪುಟ(ಗಳ) ಮೇಲೆ OCR, ಸರಾಸರಿ ವಿಶ್ವಾಸ {c}")
M("DOCX · structured text", "DOCX · व्यवस्थित लिखावट", "DOCX · ವ್ಯವಸ್ಥಿತ ಪಠ್ಯ")
P(r"(?P<n>\d+) paragraphs/rows", "{n} पैराग्राफ़/पंक्तियाँ", "{n} ಪ್ಯಾರಾಗ್ರಾಫ್/ಸಾಲುಗಳು")
P(r"XLSX · (?P<n>\d+) sheet\(s\) as records", "XLSX · {n} शीट रिकॉर्ड के रूप में", "XLSX · {n} ಶೀಟ್(ಗಳು) ದಾಖಲೆಗಳಾಗಿ")
M("Rows converted to citable records", "पंक्तियाँ हवाला देने लायक रिकॉर्ड में बदली गईं", "ಸಾಲುಗಳನ್ನು ಉಲ್ಲೇಖಿಸಬಹುದಾದ ದಾಖಲೆಗಳಾಗಿ ಬದಲಿಸಲಾಗಿದೆ")
M("Plain text", "सादा लिखावट", "ಸರಳ ಪಠ್ಯ")
M("Read", "पढ़ लिया गया", "ಓದಲಾಗಿದೆ")
M("no asset tags found", "कोई उपकरण टैग नहीं मिला", "ಯಾವುದೇ ಉಪಕರಣ ಟ್ಯಾಗ್ ಸಿಗಲಿಲ್ಲ")
P(r"(?P<n>\d+) chunks", "{n} हिस्से", "{n} ಭಾಗಗಳು")
M("FTS5 BM25 index updated", "खोज सूची (FTS5 BM25) अपडेट हो गई", "ಹುಡುಕಾಟ ಸೂಚಿ (FTS5 BM25) ನವೀಕರಿಸಲಾಗಿದೆ")

# ============================================================== access requests, grants, notifications (main.py)
M("department or document_id required", "विभाग या दस्तावेज़ चुनना ज़रूरी है", "ವಿಭಾಗ ಅಥವಾ ದಾಖಲೆ ಆಯ್ಕೆ ಕಡ್ಡಾಯ")
M("Explain briefly why you need access (at least 5 characters).", "संक्षेप में बताएँ कि आपको पहुँच क्यों चाहिए (कम से कम 5 अक्षर)।",
  "ನಿಮಗೆ ಪ್ರವೇಶ ಏಕೆ ಬೇಕು ಎಂದು ಸಂಕ್ಷಿಪ್ತವಾಗಿ ತಿಳಿಸಿ (ಕನಿಷ್ಠ 5 ಅಕ್ಷರಗಳು).")
P(r"Unknown department '(?P<d>.+)'\.", "यह विभाग मौजूद नहीं है: '{d}'।", "ಈ ವಿಭಾಗ ಇಲ್ಲ: '{d}'.")
P(r"You already have a pending request for (?P<d>.+)\. Wait for the decision \(see Inbox → Access requests\)\.",
  "{d} के लिए आपका एक अनुरोध पहले से लंबित है। फ़ैसले का इंतज़ार करें (Inbox → Access requests देखें)।",
  "{d} ಗಾಗಿ ನಿಮ್ಮ ಒಂದು ವಿನಂತಿ ಈಗಾಗಲೇ ಬಾಕಿ ಇದೆ. ನಿರ್ಧಾರಕ್ಕಾಗಿ ಕಾಯಿರಿ (Inbox → Access requests ನೋಡಿ).")
M("No approver is configured for this department. Ask the administrator to assign its HOD.",
  "इस विभाग के लिए कोई मंज़ूरी देने वाला तय नहीं है। व्यवस्थापक से इसका HOD तय करने को कहें।",
  "ಈ ವಿಭಾಗಕ್ಕೆ ಅನುಮೋದಕರನ್ನು ನಿಗದಿಪಡಿಸಿಲ್ಲ. ಅದರ HOD ಅನ್ನು ನಿಗದಿಪಡಿಸಲು ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.")
M("Request not found", "अनुरोध नहीं मिला", "ವಿನಂತಿ ಸಿಗಲಿಲ್ಲ")
M("You are not the approver for this request.", "इस अनुरोध को मंज़ूर करने वाले आप नहीं हैं।", "ಈ ವಿನಂತಿಯ ಅನುಮೋದಕರು ನೀವಲ್ಲ.")
M("You cannot approve your own request.", "आप अपना ही अनुरोध मंज़ूर नहीं कर सकते।", "ನಿಮ್ಮದೇ ವಿನಂತಿಯನ್ನು ನೀವು ಅನುಮೋದಿಸಲಾಗದು.")
M("Request already GRANTED", "अनुरोध पहले ही मंज़ूर हो चुका है", "ವಿನಂತಿ ಈಗಾಗಲೇ ಅನುಮೋದನೆಯಾಗಿದೆ")
M("Request already REJECTED", "अनुरोध पहले ही अस्वीकार हो चुका है", "ವಿನಂತಿ ಈಗಾಗಲೇ ತಿರಸ್ಕೃತವಾಗಿದೆ")
P(r"Request already (?P<s>\w+)", "अनुरोध पहले ही तय हो चुका है ({s})", "ವಿನಂತಿ ಈಗಾಗಲೇ ನಿರ್ಧಾರವಾಗಿದೆ ({s})")
M("This document is classified above your clearance; escalate the request to refinery management.",
  "यह दस्तावेज़ आपके अनुमति स्तर से ऊँचे वर्गीकरण का है; अनुरोध रिफ़ाइनरी प्रबंधन को आगे भेजें।",
  "ಈ ದಾಖಲೆಯ ವರ್ಗೀಕರಣ ನಿಮ್ಮ ಅನುಮತಿ ಮಟ್ಟಕ್ಕಿಂತ ಹೆಚ್ಚಿನದು; ವಿನಂತಿಯನ್ನು ರಿಫೈನರಿ ಆಡಳಿತಕ್ಕೆ ಮುಂದೆ ಕಳುಹಿಸಿ.")
# resource labels and grant scopes
P(r"A (?P<d>.+) document", "{d} का एक दस्तावेज़", "{d} ವಿಭಾಗದ ಒಂದು ದಾಖಲೆ")
P(r"(?P<d>.+) documents up to (?P<lvl>[A-Z]+)", "{d} के दस्तावेज़ ({lvl} स्तर तक)", "{d} ದಾಖಲೆಗಳು ({lvl} ಮಟ್ಟದವರೆಗೆ)")
P(r"(?P<d>.+) documents \((?P<t>[^()]+)\)", "{d} के दस्तावेज़ ({t})", "{d} ದಾಖಲೆಗಳು ({t})")
# notifications (stored in English, translated when listed)
P(r"Access request from (?P<n>.+)", "{n} का पहुँच अनुरोध", "{n} ಅವರಿಂದ ಪ್ರವೇಶ ವಿನಂತಿ")
P(r"(?P<d>.+) documents for (?P<h>\d+) h — “(?P<j>.*)”", "{d} के दस्तावेज़, {h} घंटे के लिए — “{j}”",
  "{d} ದಾಖಲೆಗಳು, {h} ಗಂಟೆಗಳಿಗೆ — “{j}”")
P(r"Access granted: (?P<d>.+) documents for (?P<h>\d+) h", "पहुँच मंज़ूर: {d} के दस्तावेज़, {h} घंटे के लिए",
  "ಪ್ರವೇಶ ಅನುಮೋದನೆ: {d} ದಾಖಲೆಗಳು, {h} ಗಂಟೆಗಳಿಗೆ")
P(r"Approved by (?P<n>.+) — expires (?P<t>.+) UTC", "{n} ने मंज़ूर किया — {t} UTC पर समाप्त", "{n} ಅನುಮೋದಿಸಿದ್ದಾರೆ — {t} UTC ಕ್ಕೆ ಮುಕ್ತಾಯ")
M("Access request rejected", "पहुँच अनुरोध अस्वीकार हुआ", "ಪ್ರವೇಶ ವಿನಂತಿ ತಿರಸ್ಕೃತವಾಗಿದೆ")
P(r"Escalated finding: (?P<t>.+)", "आगे भेजा गया निष्कर्ष: {t}", "ಮೇಲಕ್ಕೆ ಕಳುಹಿಸಿದ ಅವಲೋಕನ: {t}")
P(r"\[EXAMPLE\] (?P<tag>\S+) (?P<type>.+) EXPIRED (?P<n>\d+) day\(s\) ago",
  "[उदाहरण] {tag} {type} {n} दिन पहले समाप्त हो चुका है", "[ಉದಾಹರಣೆ] {tag} {type} {n} ದಿನಗಳ ಹಿಂದೆ ಅವಧಿ ಮುಗಿದಿದೆ")
P(r"\[EXAMPLE\] (?P<tag>\S+) (?P<type>.+) expires in (?P<n>\d+) day\(s\)",
  "[उदाहरण] {tag} {type} {n} दिन में समाप्त होगा", "[ಉದಾಹರಣೆ] {tag} {type} {n} ದಿನಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ")
P(r"(?P<name>.+) · ref (?P<ref>.+) · due (?P<d>\S+)", "{name} · संदर्भ {ref} · अंतिम तिथि {d}", "{name} · ಉಲ್ಲೇಖ {ref} · ಕೊನೆಯ ದಿನಾಂಕ {d}")
# alerts
P(r"(?P<tag>\S+) (?P<type>.+) expired (?P<n>\d+) d ago", "{tag} {type} {n} दिन पहले समाप्त हो चुका है",
  "{tag} {type} {n} ದಿನಗಳ ಹಿಂದೆ ಅವಧಿ ಮುಗಿದಿದೆ")
P(r"(?P<tag>\S+) (?P<type>.+) expires in (?P<n>\d+) d", "{tag} {type} {n} दिन में समाप्त होगा", "{tag} {type} {n} ದಿನಗಳಲ್ಲಿ ಅವಧಿ ಮುಗಿಯುತ್ತದೆ")
# generic "<department> documents" (after the more specific patterns above)
P(r"(?P<d>.+) documents", "{d} के दस्तावेज़", "{d} ದಾಖಲೆಗಳು")

# ============================================================== assets, findings, reports, audit, misc (main.py)
M("Asset not found", "उपकरण नहीं मिला", "ಉಪಕರಣ ಸಿಗಲಿಲ್ಲ")
M("Finding not found", "निष्कर्ष नहीं मिला", "ಅವಲೋಕನ ಸಿಗಲಿಲ್ಲ")
P(r"'(?P<act>.*)' is not allowed for you on a finding in state (?P<st>\w+)\.",
  "{st} स्थिति वाले निष्कर्ष पर आप '{act}' नहीं कर सकते।", "{st} ಸ್ಥಿತಿಯ ಅವಲೋಕನದ ಮೇಲೆ ನೀವು '{act}' ಮಾಡಲಾಗದು.")
M("Report not found", "रिपोर्ट नहीं मिली", "ವರದಿ ಸಿಗಲಿಲ್ಲ")
M("Exporting the full audit log is limited to Internal Audit, refinery management and the administrator.",
  "पूरा ऑडिट लॉग निकालना केवल आंतरिक ऑडिट, रिफ़ाइनरी प्रबंधन और व्यवस्थापक के लिए है।",
  "ಸಂಪೂರ್ಣ ಆಡಿಟ್ ಲಾಗ್ ರಫ್ತು ಆಂತರಿಕ ಆಡಿಟ್, ರಿಫೈನರಿ ಆಡಳಿತ ಮತ್ತು ನಿರ್ವಾಹಕರಿಗೆ ಮಾತ್ರ.")
M("user or document not found", "उपयोगकर्ता या दस्तावेज़ नहीं मिला", "ಬಳಕೆದಾರರು ಅಥವಾ ದಾಖಲೆ ಸಿಗಲಿಲ್ಲ")
M("Available only in demonstration mode.", "केवल डेमो मोड में उपलब्ध है।", "ಡೆಮೊ ಮೋಡ್‌ನಲ್ಲಿ ಮಾತ್ರ ಲಭ್ಯ.")
M("Unknown API route", "यह API पता मौजूद नहीं है", "ಈ API ವಿಳಾಸ ಇಲ್ಲ")

# ============================================================== startup / health (main.py)
M("Starting", "शुरू हो रहा है", "ಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ")
P(r"Preparing knowledge base \((?P<a>\d+)/(?P<b>\d+)\)", "ज्ञान-भंडार तैयार हो रहा है ({a}/{b})", "ಜ್ಞಾನ ಭಂಡಾರ ಸಿದ್ಧವಾಗುತ್ತಿದೆ ({a}/{b})")
M("Loading MRPL public information", "MRPL की सार्वजनिक जानकारी लोड हो रही है", "MRPL ಸಾರ್ವಜನಿಕ ಮಾಹಿತಿ ಲೋಡ್ ಆಗುತ್ತಿದೆ")
M("Knowledge base ready", "ज्ञान-भंडार तैयार है", "ಜ್ಞಾನ ಭಂಡಾರ ಸಿದ್ಧವಾಗಿದೆ")
M("Loading AI model", "AI मॉडल लोड हो रहा है", "AI ಮಾದರಿ ಲೋಡ್ ಆಗುತ್ತಿದೆ")
M("Restarting AI model", "AI मॉडल फिर से चालू हो रहा है", "AI ಮಾದರಿ ಮರುಪ್ರಾರಂಭವಾಗುತ್ತಿದೆ")
M("Ready (no AI model loaded)", "तैयार (कोई AI मॉडल लोड नहीं है)", "ಸಿದ್ಧ (ಯಾವುದೇ AI ಮಾದರಿ ಲೋಡ್ ಆಗಿಲ್ಲ)")
M("Ready (AI model failed to load)", "तैयार (AI मॉडल लोड नहीं हो सका)", "ಸಿದ್ಧ (AI ಮಾದರಿ ಲೋಡ್ ಆಗಲಿಲ್ಲ)")
M("Ready", "तैयार", "ಸಿದ್ಧ")
P(r"Knowledge preparation failed: (?P<e>.*)", "ज्ञान-भंडार तैयार नहीं हो सका: {e}", "ಜ್ಞಾನ ಭಂಡಾರ ಸಿದ್ಧಪಡಿಸಲು ವಿಫಲವಾಯಿತು: {e}")

# ============================================================== production planning (production.py, main.py)
M("The plant model is incomplete.", "प्लांट मॉडल अधूरा है।", "ಪ್ಲಾಂಟ್ ಮಾದರಿ ಅಪೂರ್ಣವಾಗಿದೆ.")
M("All figures are MRPL's published data with source links.", "सभी आँकड़े MRPL के प्रकाशित डेटा से हैं, स्रोत लिंक के साथ।",
  "ಎಲ್ಲ ಅಂಕಿಅಂಶಗಳು MRPL ನ ಪ್ರಕಟಿತ ಡೇಟಾ, ಮೂಲ ಲಿಂಕ್‌ಗಳೊಂದಿಗೆ.")
M("Enable at least one process unit and enter its feed and product yields.",
  "कम से कम एक प्रोसेस यूनिट चालू करें और उसका फ़ीड व उत्पाद यील्ड भरें।",
  "ಕನಿಷ್ಠ ಒಂದು ಪ್ರೋಸೆಸ್ ಘಟಕವನ್ನು ಸಕ್ರಿಯಗೊಳಿಸಿ ಮತ್ತು ಅದರ ಫೀಡ್ ಹಾಗೂ ಉತ್ಪನ್ನ ಇಳುವರಿ ನಮೂದಿಸಿ.")
M("Crude cost (US$/t).", "कच्चे तेल की लागत (US$/t)।", "ಕಚ್ಚಾ ತೈಲದ ವೆಚ್ಚ (US$/t).")
M("Crude cost (US$/t)", "कच्चे तेल की लागत (US$/t)", "ಕಚ್ಚಾ ತೈಲದ ವೆಚ್ಚ (US$/t)")
P(r"(?P<u>[^:]+): capacity \(kt/month\)\.", "{u}: क्षमता (kt/महीना)।", "{u}: ಸಾಮರ್ಥ್ಯ (kt/ತಿಂಗಳು).")
P(r"(?P<u>[^:]+): capacity \(kt/month\)", "{u}: क्षमता (kt/महीना)", "{u}: ಸಾಮರ್ಥ್ಯ (kt/ತಿಂಗಳು)")
P(r"(?P<u>[^:]+): feed \(\"crude\" or an intermediate product\)\.", "{u}: फ़ीड (\"crude\" या कोई बीच का उत्पाद)।",
  "{u}: ಫೀಡ್ (\"crude\" ಅಥವಾ ಮಧ್ಯಂತರ ಉತ್ಪನ್ನ).")
P(r"(?P<u>[^:]+): product yields\.", "{u}: उत्पाद यील्ड।", "{u}: ಉತ್ಪನ್ನ ಇಳುವರಿ.")
P(r"(?P<u>[^:]+): yields sum to more than 1\.", "{u}: यील्ड का जोड़ 1 से ज़्यादा है।", "{u}: ಇಳುವರಿಗಳ ಮೊತ್ತ 1 ಕ್ಕಿಂತ ಹೆಚ್ಚು.")
P(r"(?P<u>[^:]+): yield product '(?P<p>.+)' is not in the product list\.", "{u}: यील्ड वाला उत्पाद '{p}' उत्पाद सूची में नहीं है।",
  "{u}: ಇಳುವರಿ ಉತ್ಪನ್ನ '{p}' ಉತ್ಪನ್ನ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ.")
P(r"(?P<p>[^:]+): net-back price \(US\$/t\)\.", "{p}: नेट-बैक कीमत (US$/t)।", "{p}: ನೆಟ್-ಬ್ಯಾಕ್ ಬೆಲೆ (US$/t).")
P(r"(?P<u>[^:]+): yield of (?P<p>.+)", "{u}: {p} की यील्ड", "{u}: {p} ಇಳುವರಿ")
P(r"(?P<t_label>.+) must be a number between 0 and (?P<hi>[\d.]+) \(got (?P<v>.*)\)\.",
  "{t_label} 0 और {hi} के बीच की संख्या होनी चाहिए (मिला: {v})।", "{t_label} 0 ಮತ್ತು {hi} ನಡುವಿನ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು (ಸಿಕ್ಕಿದ್ದು: {v}).")
P(r"(?P<t_label>.+) must be a number of 0 or more \(got (?P<v>.*)\)\.",
  "{t_label} 0 या उससे बड़ी संख्या होनी चाहिए (मिला: {v})।", "{t_label} 0 ಅಥವಾ ಅದಕ್ಕಿಂತ ಹೆಚ್ಚಿನ ಸಂಖ್ಯೆಯಾಗಿರಬೇಕು (ಸಿಕ್ಕಿದ್ದು: {v}).")
P(r"Optimizer status: baseline (?P<a>\S+), scenario (?P<b>\S+) — check limits\.",
  "गणना का नतीजा: मौजूदा स्थिति {a}, नई स्थिति {b} — सीमाएँ जाँचें।", "ಲೆಕ್ಕಾಚಾರದ ಫಲಿತಾಂಶ: ಈಗಿನ ಸ್ಥಿತಿ {a}, ಹೊಸ ಸ್ಥಿತಿ {b} — ಮಿತಿಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.")
M("Linear model of the plant as entered by the planner in Yukti (capacities, yields, prices, limits).",
  "योजनाकार द्वारा Yukti में भरा गया प्लांट का सरल (रैखिक) मॉडल (क्षमता, यील्ड, कीमतें, सीमाएँ)।",
  "ಯೋಜಕರು Yukti ಯಲ್ಲಿ ನಮೂದಿಸಿದ ಪ್ಲಾಂಟ್‌ನ ಸರಳ (ರೇಖೀಯ) ಮಾದರಿ (ಸಾಮರ್ಥ್ಯ, ಇಳುವರಿ, ಬೆಲೆಗಳು, ಮಿತಿಗಳು).")
P(r"Scenario: unit downtime (?P<a>.*), price changes (?P<b>.*), crude cost change (?P<c>\S+) US\$/t\.",
  "स्थिति: यूनिट बंद रहने के दिन {a}, कीमत में बदलाव {b}, कच्चे तेल की लागत में बदलाव {c} US$/t।",
  "ಸನ್ನಿವೇಶ: ಘಟಕ ಸ್ಥಗಿತದ ದಿನಗಳು {a}, ಬೆಲೆ ಬದಲಾವಣೆ {b}, ಕಚ್ಚಾ ತೈಲ ವೆಚ್ಚದ ಬದಲಾವಣೆ {c} US$/t.")
M("Advisory only — planners decide; Yukti never writes to DCS/SCADA.",
  "केवल सलाह — फ़ैसला योजनाकार करते हैं; Yukti कभी DCS/SCADA में कुछ नहीं लिखता।",
  "ಸಲಹೆ ಮಾತ್ರ — ನಿರ್ಧಾರ ಯೋಜಕರದು; Yukti ಎಂದಿಗೂ DCS/SCADA ಗೆ ಏನನ್ನೂ ಬರೆಯುವುದಿಲ್ಲ.")
P(r"Monthly margin baseline US\$ (?P<a>[-\d,.]+) vs scenario US\$ (?P<b>[-\d,.]+)\. Largest product changes: (?P<c>.*)\. Binding: (?P<d>.*)\.",
  "मासिक मार्जिन: मौजूदा US$ {a}, नई स्थिति में US$ {b}। उत्पादों में सबसे बड़े बदलाव: {c}। पूरी क्षमता पर चल रही सीमाएँ: {d}।",
  "ಮಾಸಿಕ ಮಾರ್ಜಿನ್: ಈಗ US$ {a}, ಹೊಸ ಸನ್ನಿವೇಶದಲ್ಲಿ US$ {b}. ಉತ್ಪನ್ನಗಳಲ್ಲಿ ದೊಡ್ಡ ಬದಲಾವಣೆಗಳು: {c}. ಪೂರ್ಣ ಮಿತಿಯಲ್ಲಿರುವುದು: {d}.")
M("(AI wording withheld: it contained numbers that are not in the optimizer output.)",
  "(AI का लिखा पाठ नहीं दिखाया गया: उसमें ऐसी संख्याएँ थीं जो गणना के नतीजे में नहीं हैं।)",
  "(AI ಬರೆದ ಪಠ್ಯ ತೋರಿಸಲಾಗಿಲ್ಲ: ಅದರಲ್ಲಿ ಲೆಕ್ಕಾಚಾರದ ಫಲಿತಾಂಶದಲ್ಲಿ ಇಲ್ಲದ ಸಂಖ್ಯೆಗಳಿದ್ದವು.)")
P(r"\(AI wording unavailable: (?P<e>.*)\)", "(AI का लिखा पाठ उपलब्ध नहीं: {e})", "(AI ಬರೆದ ಪಠ್ಯ ಲಭ್ಯವಿಲ್ಲ: {e})")
