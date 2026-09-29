// Small in-house i18n: English / हिंदी / ಕನ್ನಡ. Technical & product terms stay in English.
import { useCallback, useSyncExternalStore } from 'react';

export type Lang = 'en' | 'hi' | 'kn';
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिंदी' },
  { id: 'kn', label: 'ಕನ್ನಡ' },
];

type Dict = Record<string, string>;

const en: Dict = {
  // navigation
  'nav.chat': 'Chat',
  'nav.company': 'MRPL Intelligence',
  'nav.knowledge': 'Knowledge',
  'nav.inbox': 'Inbox — approvals & access',
  'nav.assets': 'Assets & compliance',
  'nav.production': 'Production intelligence',
  'nav.audit': 'Audit log',
  'nav.admin': 'Admin',
  'nav.settings': 'Settings',
  'nav.help': 'Help',
  'nav.account': 'Account',
  // user menu
  'menu.account': 'Account & security',
  'menu.settings': 'Settings',
  'menu.sessions': 'Sessions',
  'menu.language': 'Language',
  'menu.logout': 'Log out',
  'menu.logoutAll': 'Log out all devices',
  'menu.help': 'Help & user guide',
  // page titles
  'page.inbox': 'Inbox',
  'page.inbox.sub': 'Approvals, findings and time-limited access — decided by people, and every decision is recorded',
  'page.knowledge': 'Knowledge',
  'page.knowledge.sub': 'Controlled documents Yukti can search — you only see the ones you are allowed to read',
  'page.assets': 'Assets',
  'page.production': 'Production intelligence',
  'page.admin': 'Administration',
  'page.account': 'Account & security',
  'page.help': 'Help & user guide',
  'page.settings': 'Settings',
  'page.audit': 'Audit log',
  // common buttons
  'btn.save': 'Save',
  'btn.cancel': 'Cancel',
  'btn.close': 'Close',
  'btn.refresh': 'Refresh',
  'btn.upload': 'Upload',
  'btn.create': 'Create',
  'btn.edit': 'Edit',
  'btn.delete': 'Delete',
  'btn.confirm': 'Confirm',
  'btn.retry': 'Retry',
  'btn.copy': 'Copy',
  'btn.download': 'Download',
  'btn.submit': 'Submit',
  'btn.requestAccess': 'Request access',
  'btn.addNote': 'Add note',
  'btn.acknowledge': 'Acknowledge',
  'btn.approve': 'Approve',
  'btn.reject': 'Reject',
  'btn.escalate': 'Escalate',
  'btn.changePassword': 'Change password',
  'btn.signIn': 'Sign in',
  'btn.verify': 'Verify',
  'btn.back': 'Back',
  'btn.newChat': 'New chat',
  // status chips
  'status.KNOWN': 'KNOWN',
  'status.MISSING': 'MISSING',
  'status.CONFLICTING': 'CONFLICTING',
  'status.CURRENT': 'CURRENT',
  'status.SUPERSEDED': 'SUPERSEDED',
  'status.pending': 'pending',
  'status.approved': 'approved',
  'status.rejected': 'rejected',
  'status.acknowledged': 'acknowledged',
  'status.escalated': 'escalated',
  'status.expired': 'expired',
  'status.active': 'active',
  'status.disabled': 'disabled',
  'status.locked': 'locked',
  'badge.example': 'EXAMPLE',
  'badge.example.tip': 'Example document prepared by Team UniMinds for demonstration — not MRPL data',
  'badge.public': 'PUBLIC SOURCE',
  'badge.public.tip': 'Published public MRPL source',
  // chat
  'chat.knowledgeOn': 'Knowledge on',
  'chat.knowledgeOff': 'Knowledge off',
  'chat.placeholder': 'Ask about SOPs, P&IDs, assets, certificates, work orders…',
  'chat.empty.title': 'What do you need from the plant?',
  'chat.empty.body': 'Answers are grounded in documents you are cleared to read — cited, fact-checked for conflicts, and audited.',
  'chat.sources': 'Sources',
  'chat.facts': 'Facts',
  'chat.noModel.admin': 'No model loaded —',
  'chat.noModel.user': 'The AI model is not loaded yet. Please contact your Yukti administrator.',
  'chat.helpful': 'Helpful',
  'chat.notHelpful': 'Not helpful',
  // login
  'login.title': 'Sovereign Industrial AI Workbench',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.onprem': 'Runs 100% on-premise',
  'login.footer': 'No data leaves the plant network · every action is audited',
  'login.badCredentials': 'Incorrect username or password.',
  'login.locked': 'Account temporarily locked after repeated failures.',
  'login.network': 'Cannot reach the Yukti server. Please try again in a moment, or contact your IT team.',
  'login.mfa.title': 'Two-factor authentication',
  'login.mfa.hint': 'Enter the 6-digit code from your authenticator app (or a recovery code).',
  'login.mfa.invalid': 'The code is invalid or expired. Try again.',
  'login.mfa.code': 'Authentication code',
  // account
  'knowledge.hodOnly': "Only your department's HOD can add documents.",
  'account.language': 'Language',
  'account.password': 'Password',
  'account.currentPassword': 'Current password',
  'account.newPassword': 'New password',
  'account.confirmPassword': 'Confirm new password',
  'account.mfa': 'Two-factor authentication (MFA)',
  'account.sessions': 'Sessions',
  'account.forced.title': 'Change your password to continue',
  'account.forced.body': 'Your administrator issued a temporary password. Choose a new password (at least 12 characters) before using Yukti.',
};

const hi: Dict = {
  'nav.chat': 'चैट',
  'nav.company': 'MRPL जानकारी',
  'nav.knowledge': 'ज्ञान भंडार',
  'nav.inbox': 'इनबॉक्स — अनुमोदन और एक्सेस',
  'nav.assets': 'एसेट और अनुपालन',
  'nav.production': 'उत्पादन जानकारी',
  'nav.audit': 'ऑडिट लॉग',
  'nav.admin': 'एडमिन',
  'nav.settings': 'सेटिंग्स',
  'nav.help': 'सहायता',
  'nav.account': 'खाता',
  'menu.account': 'खाता और सुरक्षा',
  'menu.settings': 'सेटिंग्स',
  'menu.sessions': 'सेशन',
  'menu.language': 'भाषा',
  'menu.logout': 'लॉग आउट',
  'menu.logoutAll': 'सभी डिवाइस से लॉग आउट',
  'menu.help': 'सहायता और उपयोग गाइड',
  'page.inbox': 'इनबॉक्स',
  'page.inbox.sub': 'अनुमोदन, निष्कर्ष और सीमित समय का एक्सेस — फ़ैसले लोग लेते हैं, और हर फ़ैसला दर्ज होता है',
  'page.knowledge': 'ज्ञान भंडार',
  'page.knowledge.sub': 'नियंत्रित दस्तावेज़ जिन्हें Yukti खोज सकता है — आपको केवल वही दिखते हैं जिन्हें पढ़ने की अनुमति है',
  'page.assets': 'एसेट',
  'page.production': 'उत्पादन जानकारी',
  'page.admin': 'प्रशासन',
  'page.account': 'खाता और सुरक्षा',
  'page.help': 'सहायता और उपयोग गाइड',
  'page.settings': 'सेटिंग्स',
  'page.audit': 'ऑडिट लॉग',
  'btn.save': 'सेव करें',
  'btn.cancel': 'रद्द करें',
  'btn.close': 'बंद करें',
  'btn.refresh': 'रीफ़्रेश करें',
  'btn.upload': 'अपलोड करें',
  'btn.create': 'बनाएँ',
  'btn.edit': 'एडिट करें',
  'btn.delete': 'हटाएँ',
  'btn.confirm': 'पुष्टि करें',
  'btn.retry': 'फिर से कोशिश करें',
  'btn.copy': 'कॉपी करें',
  'btn.download': 'डाउनलोड करें',
  'btn.submit': 'जमा करें',
  'btn.requestAccess': 'एक्सेस का अनुरोध करें',
  'btn.addNote': 'नोट जोड़ें',
  'btn.acknowledge': 'स्वीकार करें',
  'btn.approve': 'अनुमोदित करें',
  'btn.reject': 'अस्वीकार करें',
  'btn.escalate': 'आगे बढ़ाएँ',
  'btn.changePassword': 'पासवर्ड बदलें',
  'btn.signIn': 'साइन इन करें',
  'btn.verify': 'सत्यापित करें',
  'btn.back': 'वापस',
  'btn.newChat': 'नई चैट',
  'status.KNOWN': 'मिला',
  'status.MISSING': 'नहीं मिला',
  'status.CONFLICTING': 'मेल नहीं खाते',
  'status.CURRENT': 'वर्तमान',
  'status.SUPERSEDED': 'पुराना संस्करण',
  'status.pending': 'लंबित',
  'status.approved': 'अनुमोदित',
  'status.rejected': 'अस्वीकृत',
  'status.acknowledged': 'स्वीकृत',
  'status.escalated': 'आगे बढ़ाया गया',
  'status.expired': 'समाप्त',
  'status.active': 'सक्रिय',
  'status.disabled': 'निष्क्रिय',
  'status.locked': 'लॉक है',
  'badge.example': 'उदाहरण',
  'badge.example.tip': 'टीम UniMinds द्वारा प्रदर्शन हेतु तैयार उदाहरण दस्तावेज़ — MRPL डेटा नहीं',
  'badge.public': 'सार्वजनिक स्रोत',
  'badge.public.tip': 'प्रकाशित सार्वजनिक MRPL स्रोत',
  'chat.knowledgeOn': 'Knowledge चालू',
  'chat.knowledgeOff': 'Knowledge बंद',
  'chat.placeholder': 'SOP, P&ID, एसेट, प्रमाणपत्र, वर्क ऑर्डर के बारे में पूछें…',
  'chat.empty.title': 'आज प्लांट से क्या जानना है?',
  'chat.empty.body': 'उत्तर केवल उन्हीं दस्तावेज़ों पर आधारित हैं जिन्हें पढ़ने की आपको अनुमति है — स्रोत सहित, विरोधाभास-जाँच के साथ, और ऑडिट किए गए।',
  'chat.sources': 'स्रोत',
  'chat.facts': 'तथ्य',
  'chat.noModel.admin': 'कोई मॉडल लोड नहीं —',
  'chat.noModel.user': 'AI मॉडल अभी लोड नहीं है। कृपया अपने Yukti एडमिन से संपर्क करें।',
  'chat.helpful': 'उपयोगी',
  'chat.notHelpful': 'उपयोगी नहीं',
  'login.title': 'प्लांट के भीतर चलने वाला औद्योगिक AI वर्कबेंच',
  'login.username': 'उपयोगकर्ता नाम',
  'login.password': 'पासवर्ड',
  'login.onprem': '100% प्लांट के अंदर चलता है (ऑन-प्रिमाइस)',
  'login.footer': 'कोई डेटा प्लांट नेटवर्क से बाहर नहीं जाता · हर काम का रिकॉर्ड रखा जाता है',
  'login.badCredentials': 'उपयोगकर्ता नाम या पासवर्ड गलत है।',
  'login.locked': 'कई बार गलत कोशिश के कारण खाता कुछ समय के लिए लॉक कर दिया गया है।',
  'login.network': 'Yukti सर्वर से संपर्क नहीं हो पा रहा। थोड़ी देर बाद फिर कोशिश करें, या अपनी IT टीम से संपर्क करें।',
  'login.mfa.title': 'दो-चरणीय सत्यापन',
  'login.mfa.hint': 'अपने फ़ोन के authenticator ऐप से 6 अंकों का कोड (या recovery code) दर्ज करें।',
  'login.mfa.invalid': 'कोड गलत है या उसका समय खत्म हो गया है। फिर से कोशिश करें।',
  'login.mfa.code': 'सत्यापन कोड',
  'knowledge.hodOnly': 'केवल आपके विभाग के HOD दस्तावेज़ जोड़ सकते हैं।',
  'account.language': 'भाषा',
  'account.password': 'पासवर्ड',
  'account.currentPassword': 'मौजूदा पासवर्ड',
  'account.newPassword': 'नया पासवर्ड',
  'account.confirmPassword': 'नए पासवर्ड की पुष्टि करें',
  'account.mfa': 'दो-चरणीय सत्यापन (MFA)',
  'account.sessions': 'सेशन',
  'account.forced.title': 'जारी रखने के लिए पासवर्ड बदलें',
  'account.forced.body': 'आपके एडमिन ने अस्थायी पासवर्ड दिया है। Yukti का उपयोग करने से पहले नया पासवर्ड (कम से कम 12 अक्षर) चुनें।',
};

const kn: Dict = {
  'nav.chat': 'ಚಾಟ್',
  'nav.company': 'MRPL ಮಾಹಿತಿ',
  'nav.knowledge': 'ಜ್ಞಾನ ಭಂಡಾರ',
  'nav.inbox': 'ಇನ್‌ಬಾಕ್ಸ್ — ಅನುಮೋದನೆ ಮತ್ತು ಪ್ರವೇಶ',
  'nav.assets': 'ಆಸ್ತಿಗಳು ಮತ್ತು ಅನುಸರಣೆ',
  'nav.production': 'ಉತ್ಪಾದನಾ ಮಾಹಿತಿ',
  'nav.audit': 'ಆಡಿಟ್ ಲಾಗ್',
  'nav.admin': 'ಆಡ್ಮಿನ್',
  'nav.settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  'nav.help': 'ಸಹಾಯ',
  'nav.account': 'ಖಾತೆ',
  'menu.account': 'ಖಾತೆ ಮತ್ತು ಭದ್ರತೆ',
  'menu.settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  'menu.sessions': 'ಸೆಷನ್‌ಗಳು',
  'menu.language': 'ಭಾಷೆ',
  'menu.logout': 'ಲಾಗ್ ಔಟ್',
  'menu.logoutAll': 'ಎಲ್ಲಾ ಸಾಧನಗಳಿಂದ ಲಾಗ್ ಔಟ್',
  'menu.help': 'ಸಹಾಯ ಮತ್ತು ಬಳಕೆ ಮಾರ್ಗದರ್ಶಿ',
  'page.inbox': 'ಇನ್‌ಬಾಕ್ಸ್',
  'page.inbox.sub': 'ಅನುಮೋದನೆಗಳು, ಫೈಂಡಿಂಗ್‌ಗಳು ಮತ್ತು ಸಮಯ-ಮಿತಿಯ ಪ್ರವೇಶ — ನಿರ್ಧಾರ ಜನರದ್ದು, ಪ್ರತಿ ನಿರ್ಧಾರವನ್ನೂ ದಾಖಲಿಸಲಾಗುತ್ತದೆ',
  'page.knowledge': 'ಜ್ಞಾನ ಭಂಡಾರ',
  'page.knowledge.sub': 'Yukti ಹುಡುಕಬಹುದಾದ ನಿಯಂತ್ರಿತ ದಾಖಲೆಗಳು — ನೀವು ಓದಲು ಅನುಮತಿ ಇರುವವು ಮಾತ್ರ ಕಾಣುತ್ತವೆ',
  'page.assets': 'ಆಸ್ತಿಗಳು',
  'page.production': 'ಉತ್ಪಾದನಾ ಮಾಹಿತಿ',
  'page.admin': 'ಆಡಳಿತ',
  'page.account': 'ಖಾತೆ ಮತ್ತು ಭದ್ರತೆ',
  'page.help': 'ಸಹಾಯ ಮತ್ತು ಬಳಕೆ ಮಾರ್ಗದರ್ಶಿ',
  'page.settings': 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
  'page.audit': 'ಆಡಿಟ್ ಲಾಗ್',
  'btn.save': 'ಉಳಿಸಿ',
  'btn.cancel': 'ರದ್ದುಮಾಡಿ',
  'btn.close': 'ಮುಚ್ಚಿ',
  'btn.refresh': 'ರಿಫ್ರೆಶ್ ಮಾಡಿ',
  'btn.upload': 'ಅಪ್‌ಲೋಡ್ ಮಾಡಿ',
  'btn.create': 'ರಚಿಸಿ',
  'btn.edit': 'ಎಡಿಟ್ ಮಾಡಿ',
  'btn.delete': 'ಅಳಿಸಿ',
  'btn.confirm': 'ದೃಢೀಕರಿಸಿ',
  'btn.retry': 'ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ',
  'btn.copy': 'ನಕಲಿಸಿ',
  'btn.download': 'ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ',
  'btn.submit': 'ಸಲ್ಲಿಸಿ',
  'btn.requestAccess': 'ಪ್ರವೇಶ ವಿನಂತಿಸಿ',
  'btn.addNote': 'ಟಿಪ್ಪಣಿ ಸೇರಿಸಿ',
  'btn.acknowledge': 'ಅಂಗೀಕರಿಸಿ',
  'btn.approve': 'ಅನುಮೋದಿಸಿ',
  'btn.reject': 'ತಿರಸ್ಕರಿಸಿ',
  'btn.escalate': 'ಮೇಲಕ್ಕೆ ಕಳುಹಿಸಿ',
  'btn.changePassword': 'ಪಾಸ್‌ವರ್ಡ್ ಬದಲಿಸಿ',
  'btn.signIn': 'ಸೈನ್ ಇನ್ ಮಾಡಿ',
  'btn.verify': 'ಪರಿಶೀಲಿಸಿ',
  'btn.back': 'ಹಿಂದಕ್ಕೆ',
  'btn.newChat': 'ಹೊಸ ಚಾಟ್',
  'status.KNOWN': 'ಸಿಕ್ಕಿದೆ',
  'status.MISSING': 'ಸಿಗಲಿಲ್ಲ',
  'status.CONFLICTING': 'ಹೊಂದಿಕೆಯಿಲ್ಲ',
  'status.CURRENT': 'ಪ್ರಸ್ತುತ',
  'status.SUPERSEDED': 'ಹಳೆಯ ಆವೃತ್ತಿ',
  'status.pending': 'ಬಾಕಿ',
  'status.approved': 'ಅನುಮೋದಿತ',
  'status.rejected': 'ತಿರಸ್ಕೃತ',
  'status.acknowledged': 'ಅಂಗೀಕೃತ',
  'status.escalated': 'ಮೇಲಕ್ಕೆ ಕಳುಹಿಸಲಾಗಿದೆ',
  'status.expired': 'ಅವಧಿ ಮುಗಿದಿದೆ',
  'status.active': 'ಸಕ್ರಿಯ',
  'status.disabled': 'ನಿಷ್ಕ್ರಿಯ',
  'status.locked': 'ಲಾಕ್ ಆಗಿದೆ',
  'badge.example': 'ಉದಾಹರಣೆ',
  'badge.example.tip': 'ಪ್ರದರ್ಶನಕ್ಕಾಗಿ ಟೀಮ್ UniMinds ಸಿದ್ಧಪಡಿಸಿದ ಉದಾಹರಣೆ ದಾಖಲೆ — MRPL ಡೇಟಾ ಅಲ್ಲ',
  'badge.public': 'ಸಾರ್ವಜನಿಕ ಮೂಲ',
  'badge.public.tip': 'ಪ್ರಕಟಿತ ಸಾರ್ವಜನಿಕ MRPL ಮೂಲ',
  'chat.knowledgeOn': 'Knowledge ಆನ್',
  'chat.knowledgeOff': 'Knowledge ಆಫ್',
  'chat.placeholder': 'SOP, P&ID, ಆಸ್ತಿಗಳು, ಪ್ರಮಾಣಪತ್ರಗಳು, ವರ್ಕ್ ಆರ್ಡರ್‌ಗಳ ಬಗ್ಗೆ ಕೇಳಿ…',
  'chat.empty.title': 'ಪ್ಲಾಂಟ್‌ನಿಂದ ನಿಮಗೆ ಏನು ಬೇಕು?',
  'chat.empty.body': 'ಉತ್ತರಗಳು ನೀವು ಓದಲು ಅನುಮತಿ ಹೊಂದಿರುವ ದಾಖಲೆಗಳನ್ನು ಮಾತ್ರ ಆಧರಿಸಿವೆ — ಮೂಲಗಳೊಂದಿಗೆ, ವಿರೋಧಾಭಾಸ ಪರಿಶೀಲನೆಯೊಂದಿಗೆ, ಆಡಿಟ್ ಮಾಡಲಾಗಿದೆ.',
  'chat.sources': 'ಮೂಲಗಳು',
  'chat.facts': 'ಸತ್ಯಾಂಶಗಳು',
  'chat.noModel.admin': 'ಯಾವುದೇ ಮಾದರಿ ಲೋಡ್ ಆಗಿಲ್ಲ —',
  'chat.noModel.user': 'AI ಮಾದರಿ ಇನ್ನೂ ಲೋಡ್ ಆಗಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಮ್ಮ Yukti ಆಡ್ಮಿನ್ ಅನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  'chat.helpful': 'ಉಪಯುಕ್ತ',
  'chat.notHelpful': 'ಉಪಯುಕ್ತವಲ್ಲ',
  'login.title': 'ಪ್ಲಾಂಟ್ ಒಳಗೇ ಚಲಿಸುವ ಕೈಗಾರಿಕಾ AI ವರ್ಕ್‌ಬೆಂಚ್',
  'login.username': 'ಬಳಕೆದಾರ ಹೆಸರು',
  'login.password': 'ಪಾಸ್‌ವರ್ಡ್',
  'login.onprem': '100% ಪ್ಲಾಂಟ್ ಒಳಗೆ ಚಲಿಸುತ್ತದೆ (ಆನ್-ಪ್ರಿಮೈಸ್)',
  'login.footer': 'ಯಾವುದೇ ಡೇಟಾ ಪ್ಲಾಂಟ್ ನೆಟ್‌ವರ್ಕ್‌ನಿಂದ ಹೊರಹೋಗುವುದಿಲ್ಲ · ಪ್ರತಿ ಕೆಲಸವನ್ನೂ ದಾಖಲಿಸಲಾಗುತ್ತದೆ',
  'login.badCredentials': 'ಬಳಕೆದಾರ ಹೆಸರು ಅಥವಾ ಪಾಸ್‌ವರ್ಡ್ ತಪ್ಪಾಗಿದೆ.',
  'login.locked': 'ಹಲವು ಬಾರಿ ತಪ್ಪು ಪ್ರಯತ್ನಗಳ ಕಾರಣ ಖಾತೆಯನ್ನು ಸ್ವಲ್ಪ ಸಮಯ ಲಾಕ್ ಮಾಡಲಾಗಿದೆ.',
  'login.network': 'Yukti ಸರ್ವರ್ ತಲುಪಲು ಸಾಧ್ಯವಾಗುತ್ತಿಲ್ಲ. ಸ್ವಲ್ಪ ಸಮಯದ ನಂತರ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ, ಅಥವಾ ನಿಮ್ಮ IT ತಂಡವನ್ನು ಸಂಪರ್ಕಿಸಿ.',
  'login.mfa.title': 'ಎರಡು-ಹಂತದ ಪರಿಶೀಲನೆ',
  'login.mfa.hint': 'ನಿಮ್ಮ ಫೋನ್‌ನ authenticator ಆ್ಯಪ್‌ನ 6-ಅಂಕಿಯ ಕೋಡ್ (ಅಥವಾ recovery code) ನಮೂದಿಸಿ.',
  'login.mfa.invalid': 'ಕೋಡ್ ತಪ್ಪಾಗಿದೆ ಅಥವಾ ಅದರ ಸಮಯ ಮುಗಿದಿದೆ. ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
  'login.mfa.code': 'ಪರಿಶೀಲನಾ ಕೋಡ್',
  'knowledge.hodOnly': 'ನಿಮ್ಮ ವಿಭಾಗದ HOD ಮಾತ್ರ ದಾಖಲೆಗಳನ್ನು ಸೇರಿಸಬಹುದು.',
  'account.language': 'ಭಾಷೆ',
  'account.password': 'ಪಾಸ್‌ವರ್ಡ್',
  'account.currentPassword': 'ಪ್ರಸ್ತುತ ಪಾಸ್‌ವರ್ಡ್',
  'account.newPassword': 'ಹೊಸ ಪಾಸ್‌ವರ್ಡ್',
  'account.confirmPassword': 'ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ ದೃಢೀಕರಿಸಿ',
  'account.mfa': 'ಎರಡು-ಹಂತದ ಪರಿಶೀಲನೆ (MFA)',
  'account.sessions': 'ಸೆಷನ್‌ಗಳು',
  'account.forced.title': 'ಮುಂದುವರಿಯಲು ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ಬದಲಿಸಿ',
  'account.forced.body': 'ನಿಮ್ಮ ಆಡ್ಮಿನ್ ತಾತ್ಕಾಲಿಕ ಪಾಸ್‌ವರ್ಡ್ ನೀಡಿದ್ದಾರೆ. Yukti ಬಳಸುವ ಮೊದಲು ಹೊಸ ಪಾಸ್‌ವರ್ಡ್ (ಕನಿಷ್ಠ 12 ಅಕ್ಷರಗಳು) ಆಯ್ಕೆಮಾಡಿ.',
};

// Per-area dictionaries live in lib/i18n-parts/<area>.ts and export `{ en, hi, kn }`; they are merged here.
// Keys are namespaced by area (e.g. 'chat.*', 'admin.users.*'), so parts never collide.
type Part = { en?: Dict; hi?: Dict; kn?: Dict };
const parts = import.meta.glob<Part>('./i18n-parts/*.ts', { eager: true, import: 'default' });
for (const p of Object.values(parts)) {
  Object.assign(en, p.en ?? {});
  Object.assign(hi, p.hi ?? {});
  Object.assign(kn, p.kn ?? {});
}
const DICTS: Record<Lang, Dict> = { en, hi, kn };

type Vars = Record<string, string | number | null | undefined>;
/** Replace {name} placeholders. */
function fill(s: string, vars?: Vars): string {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : s;
}
const KEY = 'yukti.lang';

function initial(): Lang {
  // the desktop app opens Yukti with ?lang=hi|kn|en the first time (language chosen during setup)
  try {
    const u = new URL(window.location.href);
    const q = u.searchParams.get('lang');
    if (q === 'en' || q === 'hi' || q === 'kn') {
      try { localStorage.setItem(KEY, q); } catch { /* ignore */ }
      u.searchParams.delete('lang');
      window.history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
      return q;
    }
  } catch { /* not in a browser */ }
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'en' || v === 'hi' || v === 'kn') return v;
  } catch { /* storage unavailable */ }
  return 'en';
}
let lang: Lang = initial();
const subs = new Set<() => void>();
function applyDocLang() { try { document.documentElement.lang = lang; } catch { /* ignore */ } }
applyDocLang();

export function setLang(l: Lang) {
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  applyDocLang();
  subs.forEach((f) => f());
}
export function getLang(): Lang { return lang; }

/** Translate outside React (falls back to English, then to the key). `a` is a fallback string or {placeholders}. */
export function tr(key: string, a?: string | Vars, vars?: Vars): string {
  const fallback = typeof a === 'string' ? a : undefined;
  return fill(DICTS[lang][key] ?? en[key] ?? fallback ?? key, typeof a === 'object' ? a : vars);
}

export function useLang(): Lang {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => { subs.delete(cb); }; }, () => lang);
}

/** Hook: returns t(key, fallback? | vars?, vars?) bound to the current language.
 *  t('chat.sources', { n: 3 })  ->  "3 sources"   (dictionary: 'chat.sources': '{n} sources') */
export function useT() {
  const l = useLang();
  return useCallback((key: string, a?: string | Vars, vars?: Vars) => {
    const fallback = typeof a === 'string' ? a : undefined;
    return fill(DICTS[l][key] ?? en[key] ?? fallback ?? key, typeof a === 'object' ? a : vars);
  }, [l]);
}

/** Locale for dates and numbers in the chosen language. */
export function locale(): string { return lang === 'hi' ? 'hi-IN' : lang === 'kn' ? 'kn-IN' : 'en-IN'; }
