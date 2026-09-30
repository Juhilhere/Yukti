"""Questions that are not plant work get a short polite note; plant questions (in any language) are never refused."""
import pytest

OFF = [
    "write a poem about the monsoon", "who won yesterday's IPL match", "how do I cook paneer butter masala",
    "tell me a funny joke", "what is the capital of australia", "suggest a good movie for tonight", "help me with my maths homework",
    "एक गाना सुनाओ", "आज क्रिकेट में कौन जीता", "ಒಂದು ಕಥೆ ಹೇಳಿ", "ನಾಳೆ ಹವಾಮಾನ ಹೇಗಿರುತ್ತದೆ",
]
PLANT = [
    "A2 tripped at 02:15, give me the isolation and restart dossier", "what is the lean MDEA amine strength limit",
    "which certificates expire in the next 30 days", "there is rust on the pipe near V-501, what should I do",
    "what does NPSH mean", "who is on call in electrical", "how do I raise a permit", "what is MRPL refining capacity",
    "पंप A2 को कैसे आइसोलेट करें", "पाइप में रिसाव है क्या करें", "ಪಂಪ್ A2 ಅನ್ನು ಐಸೋಲೇಟ್ ಮಾಡುವುದು ಹೇಗೆ", "ಪೈಪ್‌ನಲ್ಲಿ ತುಕ್ಕು ಇದೆ ಏನು ಮಾಡಬೇಕು",
    "hi", "thanks", "what can you do",
]


def _is_off(text):
    from app import laya
    return laya.is_off_topic(laya.get().classify(text), text)


def test_most_unrelated_questions_are_declined_before_the_ai(app_client):
    # held-out wording (not in Laya's examples); whatever slips through is declined by the rule in the AI's instructions
    caught = [q for q in OFF if _is_off(q)]
    assert len(caught) >= 8, set(OFF) - set(caught)


@pytest.mark.parametrize("q", PLANT)
def test_plant_questions_are_never_declined(app_client, q):
    assert not _is_off(q), q


def test_decline_is_translated_and_skips_the_model(login):
    import json as _j
    u = login("ravi.e")
    chat = u.post("/api/chats", json={}).json()
    r = u.post(f"/api/chats/{chat['id']}/messages", json={"content": "write a poem about the monsoon"}, headers={"X-Lang": "hi"})
    ev = {}
    name = None
    for line in r.text.splitlines():
        if line.startswith("event:"):
            name = line[6:].strip()
        elif line.startswith("data:"):
            ev.setdefault(name, []).append(_j.loads(line[5:]))
    text = "".join(t["t"] for t in ev.get("token", []))
    assert "error" not in ev  # no model is loaded in tests: the note must not need one
    assert ev["done"][0]["stats"]["stop_reason"] == "off_topic" and "A2" in text and "प्लांट" in text


def test_no_plant_question_declined_on_the_evaluation_set(app_client):
    """130 fresh questions (English, Hinglish, Hindi, Kannada) written for evaluation, not from Laya's templates."""
    import json
    from pathlib import Path
    from app import laya
    d = json.loads((Path(__file__).parent / "data" / "router_eval.json").read_text(encoding="utf-8"))
    wrong = [x["text"] for x in d if x["intent"] != "off_topic" and laya.is_off_topic(laya.get().classify(x["text"]), x["text"])]
    assert wrong == []
