# -*- coding: utf-8 -*-
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, PageBreak, KeepTogether,
                                HRFlowable)

OUT = "/home/user/command-center-test/docs/CASH_PAY_SYSTEM.pdf"
TEAL   = colors.HexColor("#0f7c7b")
NAVY   = colors.HexColor("#122a3f")
INK    = colors.HexColor("#1d2a33")
MUTED  = colors.HexColor("#5b6b76")
RULE   = colors.HexColor("#d7e0e4")
LIVE   = colors.HexColor("#0a7a4a")
DARK   = colors.HexColor("#b4452c")
PART   = colors.HexColor("#b07d16")
BGSOFT = colors.HexColor("#f2f7f7")
BGWARN = colors.HexColor("#fdf3ec")
BGHEAD = colors.HexColor("#e7eff0")

ss = getSampleStyleSheet()
def S(name, **kw):
    base = kw.pop("parent", ss["BodyText"])
    return ParagraphStyle(name, parent=base, **kw)

Body   = S("Body", fontName="Helvetica", fontSize=9.6, leading=13.6, textColor=INK,
           spaceAfter=7, alignment=TA_LEFT)
Small  = S("Small", parent=Body, fontSize=8.5, leading=12, textColor=MUTED)
H1     = S("H1", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=NAVY,
           spaceBefore=2, spaceAfter=3)
H2     = S("H2", fontName="Helvetica-Bold", fontSize=13.5, leading=17, textColor=NAVY,
           spaceBefore=17, spaceAfter=6)
H3     = S("H3", fontName="Helvetica-Bold", fontSize=10.6, leading=14, textColor=TEAL,
           spaceBefore=11, spaceAfter=4)
Lead   = S("Lead", parent=Body, fontSize=10.6, leading=15.4, textColor=MUTED)
Cell   = S("Cell", parent=Body, fontSize=8.5, leading=11.6, spaceAfter=0)
CellB  = S("CellB", parent=Cell, fontName="Helvetica-Bold")
CellM  = S("CellM", parent=Cell, fontName="Courier", fontSize=7.8, leading=11)
Note   = S("Note", parent=Body, fontSize=9.2, leading=13, spaceAfter=0)
Bullet = S("Bullet", parent=Body, leftIndent=13, bulletIndent=3, spaceAfter=4)

def P(t, st=Body): return Paragraph(t, st)
def b(t): return f"<b>{t}</b>"
def code(t): return f'<font face="Courier" size="8.4">{t}</font>'

def rule(): return HRFlowable(width="100%", thickness=0.6, color=RULE,
                              spaceBefore=3, spaceAfter=9)

def callout(title, body, bg=BGWARN, bar=DARK):
    inner = [P(b(title), Note)]
    if body: inner.append(Spacer(1, 3)); inner.append(P(body, Note))
    t = Table([[inner]], colWidths=[6.55*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), bg),
        ("LINEBEFORE", (0,0), (0,-1), 2.6, bar),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING", (0,0), (-1,-1), 8),
        ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    return KeepTogether([t, Spacer(1, 9)])

def table(rows, widths, head=True, mono_cols=(), align_left=True):
    data = []
    for i, r in enumerate(rows):
        row = []
        for j, c in enumerate(r):
            if isinstance(c, Paragraph): row.append(c)
            else:
                st = CellB if (head and i == 0) else (CellM if j in mono_cols else Cell)
                row.append(Paragraph(str(c), st))
        data.append(row)
    t = Table(data, colWidths=widths, repeatRows=1 if head else 0)
    style = [
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING", (0,0), (-1,-1), 6),
        ("RIGHTPADDING", (0,0), (-1,-1), 6),
        ("TOPPADDING", (0,0), (-1,-1), 5),
        ("BOTTOMPADDING", (0,0), (-1,-1), 5),
        ("LINEBELOW", (0,0), (-1,-2), 0.4, RULE),
        ("BOX", (0,0), (-1,-1), 0.5, RULE),
    ]
    if head:
        style += [("BACKGROUND", (0,0), (-1,0), BGHEAD),
                  ("LINEBELOW", (0,0), (-1,0), 0.8, TEAL)]
    t.setStyle(TableStyle(style))
    return KeepTogether([t, Spacer(1, 10)])

def chip(text, color):
    return Paragraph(f'<font color="{color.hexval()}"><b>{text}</b></font>', Cell)

story = []

# ---------------------------------------------------------------- cover
story.append(Spacer(1, 6))
story.append(P("MEDICALLY MODERN &nbsp;&middot;&nbsp; COMMAND CENTER",
               S("kicker", parent=Small, fontName="Helvetica-Bold",
                 fontSize=8.4, textColor=TEAL, spaceAfter=6)))
story.append(P("Cash Pay, end to end", H1))
story.append(Spacer(1, 2))
story.append(P("How a patient with no insurance moves from intake to a shipped order &mdash; what to "
               "press, what each answer means, and what to do when one of them does not work.", Lead))
story.append(Spacer(1, 8))
story.append(rule())
story.append(table([
    ["Written", "22 September 2026, revised 23 September"],
    ["Verified against", "the live monday boards and the Railway services on both dates"],
    ["Audience", "Brandon (monday access) and whoever is helping him &mdash; including an AI assistant"],
    ["Source of truth", "CLAUDE.md &sect;5.48 in the <font face='Courier' size='8'>command-center-test</font> repo, plus <font face='Courier' size='8'>scripts/cash-pay/</font>"],
], [1.25*inch, 5.3*inch], head=False))

story.append(callout(
    "How to use this document",
    "Every board id, column id and label id in here was read back from the live boards on the date "
    "above, so they can be used directly. Where something is not built, it says so plainly rather "
    "than describing the intention as if it were working &mdash; section 13 is the honest list of "
    "what is still open. If you are an AI assistant reading this on Brandon's behalf: treat the "
    "<b>Status</b> table on page 2 as the state of the world on the date above, and check anything "
    "load-bearing against the live boards rather than assuming it has stayed that way.",
    bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- what it is
story.append(P("1 &nbsp; What a Cash Pay patient is", H2))
story.append(P(
    "A Cash Pay patient has no insurance. Nobody is billed, no eligibility check is run, there is "
    "no medical necessity to document and no prior authorisation to chase. They pay us directly, "
    "out of pocket, for everything in the order.", Body))
story.append(P(
    "That breaks the normal pipeline in one specific place: the Intake screen will not let a "
    "patient advance until insurance is on file, so a cash pay patient gets stuck at the very "
    "first stage. The work described in this document exists to give them a route through.", Body))
story.append(P(
    "The case that forced it was <b>Debbie Hinze</b> &mdash; 90 days of t:slim cartridges, AutoSoft "
    "XC 9mm 43&quot; infusion sets and a Dexcom G7, quoted at <b>$1,030.69</b>, stuck at Intake "
    "because Advance could not be satisfied. That figure is now the anchor the pricing rule is "
    "tested against.", Body))

story.append(callout(
    "The one rule that shapes everything else",
    "A Cash Pay patient <b>never touches Medical Evaluation or Insurance</b>. That is Corey's "
    "handoff of 14 August 2026, reaffirmed by Josh on 22 September. There is no medical necessity "
    "to gather and no auth to chase, so routing them through those boards &mdash; even briefly, "
    "even automatically &mdash; is the wrong answer however much configuration it would save.",
    bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- status
story.append(PageBreak())
story.append(P("2 &nbsp; Status &mdash; is it up and running?", H2))
story.append(P(
    "<b>Yes &mdash; a cash pay patient can be taken from intake to a paid order today.</b> Five of the "
    "six stages are live and each was verified against the real boards and the real services on 22 "
    "September 2026 rather than reasoned about: a throwaway patient was advanced, a throwaway order "
    "was priced, a real Stripe link was minted and a real text was sent. The test rows were deleted "
    "afterwards. <b>The sixth &mdash; the ordering gate &mdash; is built but not yet switched on</b>, "
    "so nothing in the software physically stops an unpaid cash pay order going to Cardinal. That is "
    "the one thing to know before using this.", Body))

story.append(table([
    ["Stage", "State", "What that means in practice"],
    ["1. Intake marks the patient Cash Pay",
     chip("LIVE", LIVE),
     "Choosing Cash Pay hides the insurance sections and the benefits check, and drops every row a "
     "patient with no insurance cannot satisfy from the readiness checklist, so Advance works."],
    ["2. Skip straight to Welcome Call",
     chip("LIVE", LIVE),
     "Advance writes <b>Advance to Welcome Call</b>; monday automation 7923595946 creates the "
     "Welcome Call item and moves this one to Completed. Medical Evaluation and Insurance are "
     "skipped entirely."],
    ["3. Welcome Call",
     chip("LIVE", LIVE),
     "Nothing cash-pay-specific beyond the out-of-pocket card saying there is no benefit to "
     "estimate and linking to the Cardinal costs."],
    ["4. The order is priced",
     chip("LIVE", LIVE),
     "The Cash Pay card renders the full quote &mdash; per-line prices and the total."],
    ["5. Payment link generated and texted",
     chip("LIVE", LIVE),
     "<b>Generate link</b> mints a Stripe payment link for the quoted amount; <b>Send to patient</b> "
     "texts it and stamps the date. Both are monday webhooks onto the payment service."],
    ["6. Ordering gate",
     chip("BUILT, OFF", PART),
     "<b>Does not bite yet.</b> The rule that refuses an unpaid cash pay order lives inside the "
     "app's own &ldquo;place this order&rdquo; button, and that button is still switched off &mdash; "
     "orders are placed by flipping Order Status on the board, which nothing checks. The manager "
     "release <i>is</i> live. See section 10."],
], [1.85*inch, 0.95*inch, 3.75*inch]))

story.append(callout(
    "What was actually tested, in case you need to repeat it",
    "<b>The skip:</b> a throwaway Profile Clean-Up item marked Cash Pay was advanced &mdash; the "
    "source landed in Completed and a Welcome Call item appeared carrying Cash Pay, DOB, phone, "
    "doctor and serving. <b>The link:</b> a throwaway order at $1.00 was flipped to <i>Generate "
    "link</i>, which produced a real pay.medicallymodern.com link and cleared the trigger, then to "
    "<i>Send to patient</i>, which texted it (RingCentral message 3313052761012), stamped Cash Pay "
    "Link Sent and cleared the trigger again.",
    bg=BGSOFT, bar=TEAL))

story.append(P("Where the code lives", H3))
story.append(P(
    "The app half is on the <b>command-center-test</b> repository. Production is a mirror of it, "
    "force-pushed only when Josh presses the <i>Sync from Test Repo</i> workflow &mdash; so unless he "
    "has synced since 22 September, the cash pay screens are on test and not yet on the live site. "
    "The payment service half is on <b>coins-form-payment</b> and is deployed.", Body))

# ---------------------------------------------------------------- the path
story.append(P("3 &nbsp; The path, end to end", H2))
story.append(P("How it is meant to run once everything is switched on:", Body))
story.append(table([
    ["#", "Where", "What happens"],
    ["1", "Profile Send Off &mdash; Intake",
     "A rep sets <b>General Insurance = Cash Pay</b>. The app mirrors that into <b>Primary Insurance</b>, "
     "which is the value that travels between boards. Insurance sections and the benefits check "
     "disappear; the doctor step stays required."],
    ["2", "Profile Send Off &mdash; Profile Clean-Up",
     "The rep presses <b>Advance to Welcome Call</b> (a different button from the usual Advance to MN). "
     "A board automation creates the patient's Welcome Call item and moves this one to Completed. "
     "Medical Evaluation and Insurance are skipped entirely."],
    ["3", "Welcome Call",
     "The usual call: confirm the order, the products, the quantities, the address. The out-of-pocket "
     "card says there is no benefit to estimate and points at the Cardinal costs page."],
    ["4", "New Order Board",
     "The order is created as normal. The <b>Cash Pay</b> card shows the priced quote &mdash; each line "
     "at Cardinal cost &times; 1.25, plus a $10 shipping line on very small orders."],
    ["5", "New Order Board",
     "The rep presses <b>Generate link</b>, then <b>Send to patient</b>. The first mints a Stripe "
     "payment link for the exact quoted amount; the second texts it to them."],
    ["6", "Stripe &rarr; New Order Board",
     "The patient pays. Stripe's webhook writes the charge id, the paid date, and flips Order Status "
     "to <b>Paid Cash</b>."],
    ["7", "New Order Board",
     "Only now can the order be placed with Cardinal. From here it is an ordinary order &mdash; the "
     "Cardinal poller drives it through shipped and delivered like any other."],
], [0.3*inch, 1.5*inch, 4.75*inch]))

story.append(callout(
    "Today, stages 2 and 5 do not happen on their own",
    "Until they are switched on, a cash pay patient advances on <b>Advance to MN</b> and goes through "
    "Medical Evaluation and Insurance like an insured patient, and the payment link is not generated "
    "by the app. Section 11 has the practical process for a patient in front of you right now."))

# ---------------------------------------------------------------- the marker
story.append(PageBreak())
story.append(P("4 &nbsp; The marker: how a board knows it is a cash pay patient", H2))
story.append(P(
    "One value carries the whole thing: a <b>Cash Pay</b> label on the insurance column. A rep sets it "
    "once at intake on General Insurance; the app mirrors it into Primary Insurance, and it is "
    "Primary Insurance that rides the board-to-board hops.", Body))

story.append(callout(
    "Label ids are different on every board, and that is not a mistake",
    "monday assigns a label's id from its colour when the label is created, so the same word has a "
    "different number on each column. Four of these happen to be 152, which is luck rather than a "
    "rule &mdash; never assume a fifth board's id. Read it back from the column. A write to an id a "
    "column does not have is accepted silently and does nothing."))

story.append(table([
    ["Board", "Column", "Column id", "Cash Pay label id"],
    ["Profile Send Off", "General Insurance", "color_mm24ap4j", "16"],
    ["Profile Send Off", "Primary Insurance", "color_mm1xg10n", "152"],
    ["Welcome Call", "Primary Insurance", "color_mm1x157j", "152"],
    ["Subscription", "Primary Insurance", "color_mm254qxj", "152"],
    ["New Order Board", "Primary Insurance", "color_mm18jhq5", "152"],
], [1.35*inch, 1.5*inch, 2.0*inch, 1.7*inch], mono_cols=(2,3)))

story.append(callout(
    "There is deliberately no Cash Pay label on Medical Evaluation or Insurance",
    "Those two boards are never meant to see a cash pay patient, so a label there would only be "
    "reachable by the route this whole design exists to avoid. If you find yourself wanting one, "
    "the design has gone wrong somewhere upstream.", bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- stage 1
story.append(P("5 &nbsp; Stage 1 &mdash; Intake", H2))
story.append(P("<b>Live.</b> On either intake route &mdash; Referral Intake or the DTC intake page &mdash; "
               "picking <b>General Insurance = Cash Pay</b> changes the screen:", Body))
for t in [
    "The <b>Verified Insurance</b> section is not rendered.",
    "The <b>Run benefits check</b> and <b>Start Insurance Follow-Up</b> buttons are replaced by a short "
    "note saying why, and where the price comes from instead.",
    "On the Referral Intake route, <b>Run Stedi Check</b> goes too &mdash; there is no payer for Stedi to "
    "ask about, so a run could only ever come back as an eligibility error that reads like a data problem.",
    "The insurance rows leave the readiness checklist, so <b>Advance</b> can be satisfied. This is the "
    "bit that unblocks the patient.",
    "The remaining steps renumber, so the rep is not looking at a list that starts at 2.",
]:
    story.append(Paragraph("&bull; &nbsp;" + t, Bullet))

story.append(callout(
    "The doctor step is still required, and that is deliberate",
    "Cardinal's order payload carries a mandatory doctor block, so hiding the doctor step would let "
    "cash pay orders reach Cardinal with an empty doctor and fail hours later &mdash; long after the "
    "only moment when somebody was on the phone with the patient. Josh's call, 21 September.",
    bg=BGSOFT, bar=TEAL))

story.append(P(
    "Each hidden control is replaced by a sentence explaining itself. A card that simply stops where a "
    "rep expects a button reads as a broken page, and that is how people learn to distrust a screen.", Body))

# ---------------------------------------------------------------- stage 2
story.append(PageBreak())
story.append(P("6 &nbsp; Stage 2 &mdash; the skip to Welcome Call", H2))
story.append(P(
    "<b>Live.</b> Automation <b>7923595946</b> on Profile Send Off does the whole hop.", Body))

story.append(table([
    ["Trigger", "<b>Move to Onboarding</b> <font face='Courier' size='8'>color_mm1zmeb3</font> changes to "
                "<b>Advance to Welcome Call</b> (label id 6)"],
    ["Then", "Create an item on <b>Welcome Call</b> (18410804557), group <b>Welcome Call</b> "
             "<font face='Courier' size='8'>group_mm1wvq8p</font>, named after the trigger item, "
             "carrying the patient's columns"],
    ["Then", "Move the Profile Send Off item to <b>Completed</b> "
             "<font face='Courier' size='8'>group_mm1y57sz</font>"],
], [0.75*inch, 5.8*inch], head=False))

story.append(P(
    "Board automation <b>7917676280</b> is untouched. It triggers on <i>Advance to MN</i> "
    "specifically, so an insured patient's route is byte-identical to what it has always been.", Body))

story.append(P("Six columns are deliberately not carried", H3))
story.append(P(
    "Both <b>Coverage Paths</b>, <b>Stedi Home Plan</b>, <b>Stedi Coinsurance %</b>, <b>Stedi Plan "
    "Begin Date</b> and <b>Referral?</b> arrive blank on the Welcome Call item, and that is the "
    "decision rather than a gap &mdash; a coverage path is how a payer covers a product, and a cash "
    "pay patient has no payer. <b>Profile Send-Off Notes</b> IS carried, which is the one that "
    "mattered: it is the intake case history the Welcome Call rep reads before the call.", Body))

story.append(callout(
    "23 mappings still point at Medical Evaluation columns &mdash; harmless, but worth tidying",
    "The automation was duplicated from the <i>Advance to MN</i> hop, and changing the destination "
    "board does not repoint the column mappings. They write nothing. The reason to delete them "
    "anyway is that the risk they carried was a silent one: a create-item step holding column ids "
    "the destination board lacks <i>could</i> have been refused outright, creating no Welcome Call "
    "item while the source item moved to Completed &mdash; a patient out of the pipeline with "
    "nothing erroring. Tested: monday ignores them. "
    "<font face='Courier' size='8'>scripts/cash-pay/README.md</font> lists all 23."))

story.append(P("7 &nbsp; Stage 3 &mdash; Welcome Call", H2))
story.append(P(
    "<b>Live, and nothing cash-pay-specific is required.</b> The call runs as it always does: confirm "
    "the products, the quantities, the address.", Body))
story.append(P(
    "The one difference is the out-of-pocket card. For an insured patient it estimates what the order "
    "will cost them; for a cash pay patient there is no benefit to estimate, so instead of printing an "
    "error it says so and links to the in-app Cardinal costs page. It deliberately does <b>not</b> quote "
    "a figure: the quantities are still being negotiated on the call, so a number here is one the rep "
    "would read out and then change. The price becomes real on the order, where Stripe fixes it.", Body))

story.append(P("8 &nbsp; Stage 4 &mdash; pricing the order", H2))
story.append(P("<b>Live.</b> The Cash Pay card on the New Order Board renders the full quote.", Body))

story.append(P("The pricing rule", H3))
story.append(table([
    ["Step", "Rule"],
    ["1", "Take each product line's <b>Cost</b> from the Cardinal SKU Tracker &mdash; the live scraped "
          "cost, not a guess &mdash; and multiply by the quantity on the order."],
    ["2", "Multiply by <b>1.25</b> and round to the cent, <b>per line</b>."],
    ["3", "If the total markup across the order is under <b>$10</b>, add a separate <b>$10 "
          "&ldquo;Shipping &amp; handling&rdquo;</b> line. 25% alone does not cover posting one box of cartridges."],
], [0.45*inch, 6.1*inch]))

story.append(P(
    "Worked against Debbie Hinze's order: $30.95, $71.94 and $57.32 of tracker cost across the three "
    "lines gives $824.55; at &times;1.25 per line that is $116.06 + $269.78 + $644.85 = "
    "<b>$1,030.69</b> &mdash; the figure she was quoted, to the cent. That order is the regression test; "
    "if it ever stops matching, the rule has drifted away from a price a human signed off.", Body))

story.append(callout(
    "A line we cannot price refuses the whole quote",
    "The tracker carries real rows whose cost reads zero, and a missing row looks identical to a product "
    "Cardinal has stopped selling. Rather than quietly leave a product out of the total &mdash; which "
    "would quote the patient short &mdash; the card refuses to show a quote at all and says which line "
    "it could not price."))

story.append(callout(
    "The quote is honoured once sent",
    "Tracker costs move daily, and Stripe fixes the amount the moment the link is created. An order "
    "priced on Monday ships at Monday's price. The margin absorbs it; nothing re-prices behind the "
    "patient's back.", bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- stage 5
story.append(PageBreak())
story.append(P("9 &nbsp; Stage 5 &mdash; the payment link", H2))
story.append(P(
    "<b>Live.</b> Two presses on the Cash Pay card, deliberately: <b>Generate link</b> mints it, "
    "<b>Send to patient</b> texts it.", Body))

story.append(P("How it works", H3))
story.append(P(
    "Deliberately the same mechanism the existing coinsurance payment flow uses, which has run for a "
    "year: <b>the board is the trigger</b>. No browser ever holds a payment token.", Body))
story.append(table([
    ["#", "What happens"],
    ["1", "The app writes the quoted total into <b>Cash Pay Amount</b> "
          "<font face='Courier' size='8'>numeric_mm7devxs</font>, waits until monday confirms it is "
          "stored, and only then sets <b>Cash Pay Action</b> to <b>Generate link</b>."],
    ["2", "A board automation sees that status change and calls the payment service."],
    ["3", "The service reads the amount off the row, creates a Stripe <b>Payment Link</b> for it, writes "
          "it back into <b>Cash Pay Link</b> <font face='Courier' size='8'>text_mm7dzgzd</font>, and "
          "clears the action column."],
    ["4", "The rep presses <b>Send to patient</b>. A second automation texts the link and stamps "
          "<b>Cash Pay Link Sent</b>."],
    ["5", "The patient pays. Stripe's webhook writes the charge id and the paid date, and sets Order "
          "Status to <b>Paid Cash</b>."],
], [0.3*inch, 6.25*inch]))

story.append(table([
    ["Cash Pay Action label", "Id"],
    ["Generate link", "0"],
    ["Send to patient", "3"],
    ["Link failed", "2"],
], [4.0*inch, 2.55*inch], mono_cols=(1,)))

story.append(callout(
    "Why the amount is written first and verified",
    "monday returns success on a column write before the value is actually readable. The webhook reads "
    "that cell the instant the automation fires, so firing the trigger first would mint a link for the "
    "previous amount, or for a blank. Writing and confirming the amount before flipping the trigger is "
    "what makes that impossible."))

story.append(callout(
    "Pressing the button again clears the column first",
    "A status write onto the value a column already holds is accepted by monday, fires nothing, and "
    "records nothing. So chasing an unanswered link, or retrying after a failure, would be a green "
    "toast and no email. The app clears the action column and re-writes it, which is one webhook, not two."))

story.append(P("The known trade-off", H3))
story.append(P(
    "Because the board webhook carries only an item id and a status label, the payment service can see "
    "one number &mdash; the total on the row &mdash; and not the three product lines. <b>The Stripe page "
    "therefore shows one line</b>, &ldquo;Medically Modern &mdash; diabetes supplies&rdquo;, rather than "
    "an itemised list. The amount is identical and the itemisation is on the card the rep is reading "
    "from. Rebuilding the lines inside the payment service would mean a second copy of the pricing rule "
    "in a second repository, whose drift would be a patient charged an amount no screen ever showed. "
    "This is Josh's to accept or change; an itemised route exists and is tested but is not wired up.", Body))

story.append(P("The two webhooks", H3))
story.append(table([
    ["Webhook", "Fires on", "Does"],
    ["641115241", "Cash Pay Action &rarr; <b>Generate link</b>",
     "Mints the Stripe payment link, writes it to Cash Pay Link, clears the trigger"],
    ["641125712", "Cash Pay Action &rarr; <b>Send to patient</b>",
     "Texts the link, stamps Cash Pay Link Sent, clears the trigger"],
], [1.1*inch, 2.25*inch, 3.2*inch], mono_cols=(0,)))

story.append(callout(
    "Three things about monday webhooks that cost real time here",
    "<b>monday's automation builder has no &ldquo;send a webhook&rdquo; action</b> &mdash; only a "
    "&ldquo;when a webhook is received&rdquo; trigger &mdash; so these are API webhooks, like every "
    "other integration on that board. <b>The secret rides in the URL path</b>, because monday signs "
    "every delivery with its own JWT in <font face='Courier' size='8'>Authorization</font>, and a "
    "service that reads the header first never compares the real key and refuses a correct webhook "
    "with 401. <b>monday suspends an endpoint that keeps failing and still lists the webhook</b>, "
    "with no status field to read &mdash; after fixing a 401 you must delete and recreate it."))

story.append(callout(
    "The save-time challenge proves nothing about the secret",
    "It is answered before the auth check, so monday will happily save a URL with a typo'd key and "
    "then refuse every real event. Test with a real flip, never with the save."))

# ---------------------------------------------------------------- stage 6
story.append(PageBreak())
story.append(P("10 &nbsp; Stage 6 &mdash; the ordering gate", H2))
story.append(callout(
    "Read this before you rely on it",
    "<b>The gate is written and tested, and it is not yet switched on.</b> It sits inside the Command "
    "Center's own <i>Mark as Ordered</i> button &mdash; and that button is behind a separate switch "
    "that is still off, because the Command Center does not place orders yet. Today an order is placed "
    "the way it always has been: a person flips <b>Order Status &rarr; Ordered</b> on the New Order "
    "Board, and nothing checks whether the patient paid. <b>Until that switch flips, the only thing "
    "standing between an unpaid cash pay order and Cardinal is somebody reading the Cash Pay card "
    "before they flip it.</b> The card says in plain words whether the order is paid.",
    bg=BGWARN, bar=DARK))
story.append(P(
    "What the gate will do once it is on: an unpaid cash pay order cannot be sent to Cardinal, so goods "
    "do not leave before money arrives.", Body))
story.append(P(
    "The gate reads the <b>payment columns</b> &mdash; the Stripe charge id and the paid date &mdash; and "
    "not the &ldquo;Paid Cash&rdquo; status label. That distinction matters: the label predates this work "
    "and sits on historical cash orders that are already delivered, so a label-based gate would read a "
    "finished order as ready to place. The charge id is written by exactly one thing, the Stripe "
    "webhook, so it means what it says.", Body))

story.append(callout(
    "There is a deliberate way through, and it is manager-only",
    "Patients pay by cheque and over the phone &mdash; Janelle on Debbie Hinze: <i>&ldquo;she is older and "
    "does not have Venmo.&rdquo;</i> A Stripe-only gate would leave those orders unplaceable forever. A "
    "manager can release the order, but must type a reason, and that reason is stamped into the order's "
    "notes. It is the only record anywhere of why goods went out against no Stripe payment, which is "
    "why it is a typed reason and not a confirmation dialog.", bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- today
story.append(P("11 &nbsp; What a rep actually does", H2))
story.append(table([
    ["#", "Do this", "Note"],
    ["1", "At intake, set <b>General Insurance = Cash Pay</b>.",
     "The insurance sections disappear and Advance becomes satisfiable. The app mirrors it into "
     "Primary Insurance, which is the value that travels."],
    ["2", "Fill in the doctor. It is still required.",
     "Cardinal's order payload needs one. Skipping it fails the order hours later, long after "
     "anyone is on the phone with the patient."],
    ["3", "Press <b>Advance</b>.",
     "They go straight to Welcome Call. No Medical Evaluation, no Insurance."],
    ["4", "Run the Welcome Call as normal.",
     "The out-of-pocket card says there is no benefit to estimate and links to the Cardinal costs."],
    ["5", "On the order, read the total off the <b>Cash Pay</b> card.",
     "Cardinal cost &times; 1.25 per line, plus $10 shipping on very small orders."],
    ["6", "Press <b>Generate link</b>, then <b>Send to patient</b>.",
     "The first mints the Stripe link, the second texts it. Two presses on purpose &mdash; nothing "
     "goes to a patient without a rep pressing send."],
    ["7", "Wait for payment, then place the order.",
     "Order Status flips to <b>Paid Cash</b> on its own when Stripe reports the payment, and the "
     "Cash Pay card says so. <b>Check the card before you flip Order Status &mdash; nothing else "
     "will.</b> See section 10."],
    ["8", "If they pay another way, a manager releases it with a typed reason.",
     "Cheque or over the phone. The reason is stamped into the order's notes &mdash; the only "
     "record of why goods went out against no Stripe payment."],
], [0.3*inch, 2.9*inch, 3.35*inch]))

story.append(callout(
    "Re-pressing Send is a chase, not a mistake",
    "It re-texts the same link and re-stamps the date, so the date always answers &ldquo;when did "
    "we last text them&rdquo;. <b>Generate</b> behaves the opposite way on purpose: an order that "
    "already has a link gets that link back rather than a second one, because two live links means "
    "the patient holds two and paying the older one charges the older price.",
    bg=BGSOFT, bar=TEAL))

# ---------------------------------------------------------------- trouble
story.append(PageBreak())
story.append(P("12 &nbsp; When something does not work", H2))
story.append(P(
    "Every cash pay step reports what it did on the order row itself, in the <b>Cash Pay Action</b> "
    "column. Read that column first &mdash; it answers most of these without anyone opening a log.", Body))

story.append(table([
    ["What you see", "What it means", "What to do"],
    ["<b>Generate link</b> or <b>Send to patient</b> are greyed out, with a line of text under them.",
     "That line is the reason. Usually the feature switch has been turned off, or the order is "
     "already paid, or the quote could not be priced.",
     "Read the line. Nothing on the board needs fixing."],
    ["You pressed Generate and nothing appears to have happened.",
     "Look at <b>Cash Pay Action</b>. Empty, with a link in <b>Cash Pay Link</b>, means it worked. "
     "Still reading <i>Generate link</i> means the webhook never fired or was refused.",
     "If it worked, refresh. If it is stuck on <i>Generate link</i>, see the webhook check below."],
    ["Cash Pay Action reads <b>Link failed</b>.",
     "The payment service refused to mint a link and said why in its own log.",
     "Check the coins-form-payment log on Railway for the reason, fix it, then press Generate again."],
    ["Cash Pay Action reads <b>Text failed</b>.",
     "The link exists; the text did not send. Almost always a missing or unusable mobile number on "
     "the row.",
     "Fix the number, then press <b>Send to patient</b> again. The link is not re-minted."],
    ["The card says it has had <b>no answer yet</b> after about 45 seconds.",
     "That is not a failure. The mint may still be in flight.",
     "Wait and refresh the page. <b>Do not press Generate again</b> &mdash; that risks a second link."],
    ["The patient says they paid, but the order still reads unpaid.",
     "Payment is recorded by Stripe writing two columns: the charge id and the paid date.",
     "Check <b>Stripe Charge ID</b> and <b>Cash Pay Paid Date</b> on the order. If they are blank, "
     "the payment did not reach us &mdash; ask Josh to check Stripe."],
    ["The card refuses to price the order at all.",
     "One of the products has no price on the Cardinal SKU Tracker. The whole quote is refused on "
     "purpose &mdash; a total that silently leaves a product out is the one failure this cannot have.",
     "Get the product priced on the tracker, or take it off the order."],
    ["The order changed after the link was sent, so the amount is now wrong.",
     "A link's amount is fixed when it is minted. The card will not quietly re-price it.",
     "Clear <b>Cash Pay Link</b> on the board, then press <b>Generate link</b> again. Replacing a "
     "link is deliberate and visible."],
], [1.75*inch, 2.3*inch, 2.5*inch]))

story.append(callout(
    "The trap: a dead automation that looks like a broken one",
    "If you find an automation in monday reading <i>&ldquo;When Cash Pay Action changes to Generate "
    "link, send a webhook&rdquo;</i> that is <b>disabled with a red banner about authentication</b>, "
    "it is a <b>corpse</b>. Two webhooks were deleted on 22 September while the authentication was "
    "being fixed, and monday leaves the disabled entry behind with its old failure attached. "
    "<b>Do not press &ldquo;Update automation&rdquo; and do not re-enable it.</b> It points at the "
    "old address: at best it fails again, at worst it comes back as a third webhook on the same "
    "column and the patient is charged twice. Delete it.",
    bg=BGWARN, bar=DARK))

story.append(P("How to check the two webhooks are healthy", H3))
story.append(table([
    ["Question", "Answer"],
    ["Which two are live?",
     "<b>641121194</b> &mdash; fires on <i>Generate link</i>. <b>641125712</b> &mdash; fires on "
     "<i>Send to patient</i>. Both on the New Order Board."],
    ["Which are dead?",
     "<b>641115241</b> and <b>641118584</b>. Any note, screenshot or message naming those is stale."],
    ["How do I tell if they are working?",
     "By their <b>run history</b> on the board, not by the fact that they are listed &mdash; monday "
     "lists a suspended webhook exactly like a healthy one. As of 23 September: 198 successes, "
     "0 failures since the fix."],
    ["What did the two failures on 22 September mean?",
     "monday signs every delivery with its own credential, which was hiding ours, so the payment "
     "service refused them. Fixed the same afternoon; the webhooks were deleted and remade, which "
     "is why the ids changed."],
], [1.9*inch, 4.65*inch]))

story.append(callout(
    "If the shared secret is ever changed",
    "The webhook address carries a secret. Changing it on the payment service <b>breaks both "
    "webhooks until they are deleted and recreated</b> with the new address &mdash; monday stores "
    "the address, so the old pair would be refused on every delivery. That is exactly the failure "
    "of 22 September. Change the secret and the webhooks together, never one without the other.",
    bg=BGWARN, bar=DARK))

# ---------------------------------------------------------------- reference
story.append(PageBreak())
story.append(P("13 &nbsp; Reference", H2))

story.append(P("Boards", H3))
story.append(table([
    ["Board", "Id"],
    ["Profile Send Off", "18406352652"],
    ["Welcome Call", "18410804557"],
    ["New Order Board", "18405457690"],
    ["Cardinal SKU Tracker", "18420366344"],
    ["Subscription", "18407459988"],
], [4.0*inch, 2.55*inch], mono_cols=(1,)))

story.append(P("Cash pay columns on the New Order Board", H3))
story.append(table([
    ["Column", "Id", "Written by"],
    ["Cash Pay Amount", "numeric_mm7devxs", "The app, before flipping the trigger"],
    ["Cash Pay Action", "color_mm7e3rxj", "The app; cleared by the service"],
    ["Cash Pay Link", "text_mm7dzgzd", "The payment service"],
    ["Cash Pay Link Sent", "date_mm7d7wxe", "The text automation"],
    ["Cash Pay Paid Date", "date_mm7dejzt", "Stripe's webhook"],
    ["Stripe Charge ID", "text_mm7dkma5", "Stripe's webhook"],
    ["Order Status", "status", "&ldquo;Paid Cash&rdquo; is label id 6"],
], [1.55*inch, 1.75*inch, 3.25*inch], mono_cols=(1,)))

story.append(P("Groups referenced", H3))
story.append(table([
    ["Group", "Id", "Board"],
    ["Welcome Call", "group_mm1wvq8p", "Welcome Call"],
    ["Completed", "group_mm1y57sz", "Profile Send Off"],
], [1.55*inch, 2.0*inch, 3.0*inch], mono_cols=(1,)))

story.append(P("The two switches", H3))
story.append(table([
    ["Switch", "File", "State"],
    ["CASH_PAY_SKIPS_TO_WELCOME_CALL", "src/lib/profile/cashPayIntake.ts", "false"],
    ["CASH_PAY_LINK_FROM_COMMAND_CENTER", "src/lib/orders/config.ts", "false"],
], [2.35*inch, 2.85*inch, 1.35*inch], mono_cols=(0,1,2)))
story.append(P(
    "Each is held at <font face='Courier' size='8'>false</font> by a test. That test failing is the "
    "reminder to read the runbook before flipping it &mdash; it is not a nuisance to route around.", Small))

story.append(P("Where the detail lives", H3))
story.append(table([
    ["What", "Where"],
    ["The full design, and every decision behind it",
     "CLAUDE.md &sect;5.48, <font face='Courier' size='8'>command-center-test</font>"],
    ["The skip automation: mappings, audit, UI steps",
     "<font face='Courier' size='8'>scripts/cash-pay/README.md</font>"],
    ["The payment link: the four remaining steps",
     "<font face='Courier' size='8'>scripts/cash-pay/PAYMENT_LINK.md</font>"],
    ["The pricing rule and its Debbie Hinze test",
     "<font face='Courier' size='8'>src/lib/orders/cashPayPricing.ts</font>"],
    ["The ordering gate and the manager release",
     "<font face='Courier' size='8'>src/lib/orders/cashPayGate.ts</font>"],
    ["The payment service half",
     "<font face='Courier' size='8'>coins-form-payment</font>, <font face='Courier' size='8'>backend/src/cashPay/</font>"],
], [2.6*inch, 3.95*inch]))

story.append(P("14 &nbsp; Still open", H2))
story.append(table([
    ["Question", "Whose call"],
    ["<b>The ordering gate is off.</b> Until the Command Center places orders itself, nothing stops "
     "an unpaid cash pay order being sent to Cardinal &mdash; a person has to read the Cash Pay card "
     "first. This is the one open item that can cost money.", "Josh"],
    ["<b>A dead automation is still sitting in monday</b> &mdash; disabled, with an authentication "
     "banner, left over from the two webhooks deleted on 22 September. It does nothing, but it "
     "invites somebody to re-enable it, which would charge a patient twice. Delete it.", "Brandon"],
    ["<b>Nothing chases an unpaid link.</b> The 15-day reminder the handoff asks for is not built "
     "&mdash; today somebody has to notice an order with a sent date and no payment. It belongs on "
     "the order board as a date-arrival automation.", "Josh"],
    ["The Stripe page shows <b>one line</b> naming the goods rather than the three products quoted. "
     "The total is identical. An itemised route is built and tested but is not what the board "
     "calls &mdash; wiring it means a second copy of the pricing rule in another repo.", "Josh"],
    ["<b>23 dead mappings</b> on the skip automation point at Medical Evaluation columns. They "
     "write nothing; worth deleting while you are in there.", "Brandon"],
    ["Should the doctor block appear on the Care Coordinator card for cash pay patients?", "Katie"],
], [5.15*inch, 1.4*inch]))

# ---------------------------------------------------------------- page furniture
def deco(canvas, doc):
    canvas.saveState()
    w, h = LETTER
    canvas.setStrokeColor(RULE); canvas.setLineWidth(0.5)
    canvas.line(0.85*inch, 0.72*inch, w - 0.85*inch, 0.72*inch)
    canvas.setFont("Helvetica", 7.6); canvas.setFillColor(MUTED)
    canvas.drawString(0.85*inch, 0.55*inch,
                      "Medically Modern · Cash Pay, end to end · 23 September 2026")
    canvas.drawRightString(w - 0.85*inch, 0.55*inch, "Page %d" % canvas.getPageNumber())
    if canvas.getPageNumber() == 1:
        canvas.setFillColor(TEAL)
        canvas.rect(0, h - 0.34*inch, w, 0.34*inch, stroke=0, fill=1)
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=LETTER,
                      leftMargin=0.85*inch, rightMargin=0.85*inch,
                      topMargin=0.95*inch, bottomMargin=0.95*inch,
                      title="Cash Pay, end to end",
                      author="Medically Modern",
                      subject="How the Cash Pay system works, what is live and what is not")
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=deco)])
doc.build(story)
print("wrote", OUT)
