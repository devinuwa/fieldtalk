"""V1 grounding: every crop, plot and quantity must exist in the transcript.

AGENTS.md rule 2: an extracted field that cannot be found in the transcript after
normalization is marked ungrounded (``grounded: false`` in the API view) and keeps its
value for the UI to highlight — it is never silently accepted, and never dropped either.

Normalization is deliberately boring: lowercase, letters and digits only, whitespace
collapsed. Quantities get one extra step: spelled-out numbers ("five baskets") are
looked for as digits (5), because the model emits ``value: 5`` while the farmer said
"five". Both the number and the unit must be present in the transcript.

Date *expressions* are not searched for here: they carry no numbers the model invented
(code resolves them, engine/tests cover that) — but the *resolved* date is computed in
``verify_entries`` with ``engine.resolve_date`` against the recording date, never by the
model (AGENTS.md rule 1).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from ..engine import DateExpr, Quantity, resolve_date
from .schema import ExtractedEntry

# A span of the *original* transcript: [start, end) as character offsets.
Span = tuple[int, int]


def normalize_with_map(text: str) -> tuple[str, list[int]]:
    """Lowercase, drop punctuation, collapse whitespace — keeping an index map.

    Returns ``(normalized, map)`` where ``map[i]`` is the offset of ``normalized[i]`` in
    the original text, so a match in normalized space can be shown as a highlight on the
    original transcript.
    """
    chars: list[str] = []
    offsets: list[int] = []
    for index, char in enumerate(text):
        lowered = char.lower()
        if lowered.isalnum():
            chars.append(lowered)
            offsets.append(index)
        elif chars and chars[-1] != " ":
            chars.append(" ")
            offsets.append(index)
    if chars and chars[-1] == " ":
        chars.pop()
        offsets.pop()
    return "".join(chars), offsets


def _find_word(normalized: str, needle: str) -> Span | None:
    """Find ``needle`` in ``normalized`` on word boundaries, else None."""
    if not needle:
        return None
    start = normalized.find(needle)
    while start != -1:
        end = start + len(needle)
        before_ok = start == 0 or not normalized[start - 1].isalnum()
        after_ok = end == len(normalized) or not normalized[end].isalnum()
        if before_ok and after_ok:
            return start, end
        start = normalized.find(needle, start + 1)
    return None


def _to_span(span: Span | None, offsets: list[int]) -> Span | None:
    if span is None:
        return None
    start, end = span
    return offsets[start], offsets[end - 1] + 1


# --- spelled-out numbers ---------------------------------------------------

_BASIC_NUMBERS: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_SCALES: dict[str, int] = {"hundred": 100, "thousand": 1_000, "million": 1_000_000}
_MAX_NUMBER_TOKENS = 6


def _parse_number(tokens: list[str], start: int) -> tuple[int, int] | None:
    """Parse an English number at ``tokens[start:]`` -> (value, next_index)."""
    total = 0
    current = 0
    index = start
    consumed = 0
    while index < len(tokens) and consumed < _MAX_NUMBER_TOKENS:
        token = tokens[index]
        if token in _BASIC_NUMBERS:
            current += _BASIC_NUMBERS[token]
        elif token in _SCALES:
            current = (current or 1) * _SCALES[token]
            if _SCALES[token] >= 1_000:
                total += current
                current = 0
        else:
            break
        index += 1
        consumed += 1
    if consumed == 0:
        return None
    return total + current, index


def normalize_numbers_with_map(text: str) -> tuple[str, list[int]]:
    """Like ``normalize_with_map``, but spelled-out numbers become digits.

    ``"five baskets"`` becomes ``"5 baskets"`` with every digit mapped back to the span
    of the word it came from, so ``quantity.value = 5`` can be grounded in the original.
    """
    normalized, offsets = normalize_with_map(text)
    tokens = normalized.split(" ")
    # offsets for each token: (start_index_in_normalized, end_index_in_normalized)
    spans: list[tuple[int, int]] = []
    cursor = 0
    for token in tokens:
        spans.append((cursor, cursor + len(token)))
        cursor += len(token) + 1

    out_chars: list[str] = []
    out_offsets: list[int] = []
    index = 0
    while index < len(tokens):
        parsed = _parse_number(tokens, index)
        if parsed is None:
            token_start, token_end = spans[index]
            for position in range(token_start, token_end):
                out_chars.append(normalized[position])
                out_offsets.append(offsets[position])
            out_chars.append(" ")
            out_offsets.append(offsets[token_start])
            index += 1
            continue
        value, next_index = parsed
        digits = str(value)
        first_start = spans[index][0]
        last_end = spans[next_index - 1][1]
        for digit in digits:
            out_chars.append(digit)
            out_offsets.append(offsets[first_start])
        out_chars.append(" ")
        out_offsets.append(offsets[first_start])
        index = next_index

    # Trim the trailing space so the map stays 1:1 with the string.
    if out_chars and out_chars[-1] == " ":
        out_chars.pop()
        out_offsets.pop()
    return "".join(out_chars), out_offsets


def _format_quantity_value(value: float) -> str:
    if float(value).is_integer():
        return str(int(value))
    return str(value)


# ---------------------------------------------------------------------------
# Grounding results
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Grounding:
    """Where each field was found in the transcript (``None`` = not found)."""

    plot: Span | None = None
    crop: Span | None = None
    quantity: Span | None = None
    ungrounded: tuple[str, ...] = ()

    @property
    def grounded(self) -> bool:
        return not self.ungrounded


def ground_entry(entry: ExtractedEntry, transcript: str) -> Grounding:
    """V1: find plot, crop and quantity in the transcript; record spans."""
    normalized, offsets = normalize_with_map(transcript)
    ungrounded: list[str] = []

    plot_span = None
    if entry.plot is not None:
        needle, _ = normalize_with_map(entry.plot)
        plot_span = _to_span(_find_word(normalized, needle), offsets)
        if plot_span is None:
            ungrounded.append("plot")

    crop_span = None
    if entry.crop is not None:
        needle, _ = normalize_with_map(entry.crop)
        crop_span = _to_span(_find_word(normalized, needle), offsets)
        if crop_span is None:
            ungrounded.append("crop")

    quantity_span = None
    if entry.quantity is not None:
        quantity_span = _ground_quantity(entry.quantity, transcript)
        if quantity_span is None:
            ungrounded.append("quantity")

    return Grounding(
        plot=plot_span,
        crop=crop_span,
        quantity=quantity_span,
        ungrounded=tuple(ungrounded),
    )


def _ground_quantity(quantity: Quantity, transcript: str) -> Span | None:
    """The number and the unit must both appear in the transcript."""
    numbers_normalized, number_offsets = normalize_numbers_with_map(transcript)
    value_text = _format_quantity_value(quantity.value)
    number_span = _find_word(numbers_normalized, value_text)
    if number_span is None:
        return None
    number_start = number_offsets[number_span[0]]
    number_end = number_offsets[number_span[1] - 1] + 1

    plain_normalized, plain_offsets = normalize_with_map(transcript)
    unit_needle, _ = normalize_with_map(quantity.unit)
    unit_span = _find_word(plain_normalized, unit_needle)
    if unit_span is None:
        return None
    unit_start = plain_offsets[unit_span[0]]
    unit_end = plain_offsets[unit_span[1] - 1] + 1

    return min(number_start, unit_start), max(number_end, unit_end)


# ---------------------------------------------------------------------------
# Deterministic guards (no model involved): see AGENTS.md rule 1/2
# ---------------------------------------------------------------------------

# Date phrases a note can carry. "May" is both a month and a common verb; counting it
# can only make guard (a) quieter (it keeps a date rather than dropping it), never
# wrong in the other direction.
_DATE_PHRASE_RE = re.compile(
    r"\b(today|yesterday|tomorrow|this morning|this afternoon|this evening|"
    r"days? ago|weeks? ago|months? ago|last week|next week|"
    r"january|february|march|april|may|june|july|august|september|october|"
    r"november|december|"
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b"
)

# Words that name no particular crop (guard (b)).
GENERIC_CROP_WORDS: frozenset[str] = frozenset(
    {"plants", "plant", "crops", "crop", "field", "farm", "garden", "leaves"}
)


def observation_date_phrase_count(transcript: str) -> int:
    """Occurrences of date phrases in the transcript (case/punctuation insensitive)."""
    normalized, _ = normalize_with_map(transcript)
    return len(_DATE_PHRASE_RE.findall(normalized))


def _same_date_expr(left: DateExpr, right: DateExpr) -> bool:
    """Do two expressions name the same date? (Ignores fields a kind does not use.)"""
    if left.kind != right.kind:
        return False
    if left.kind == "days_ago":
        return left.n == right.n
    if left.kind == "month_day":
        return left.month == right.month and left.day == right.day
    return True  # "today": no other fields


def guard_duplicate_date(entry: ExtractedEntry, phrase_count: int) -> DateExpr | None:
    """Guard (a): drop ``date_expr`` when it merely repeats ``planting_date_expr``.

    If the two expressions name the same date and the transcript holds fewer than two
    date phrases, the single phrase dates the *planting* only — there is no separate
    date for the observation, so the observation date expression must be null (the
    model copied the planting date into both fields; AGENTS.md rule 1: code decides).
    Returns the (possibly unchanged) expression to use.
    """
    if entry.date_expr is None or entry.planting_date_expr is None:
        return entry.date_expr
    if not _same_date_expr(entry.date_expr, entry.planting_date_expr):
        return entry.date_expr
    if phrase_count < 2:
        return None
    return entry.date_expr


# ---------------------------------------------------------------------------
# Verified entries: grounding + dates resolved in code
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class VerifiedEntry:
    """One entry with V1 spans and its dates resolved against the recording date."""

    plot: str | None
    crop: str | None
    kind: str
    text: str
    quantity: Quantity | None
    date_expr: DateExpr | None
    planting_date_expr: DateExpr | None
    plot_span: Span | None
    crop_span: Span | None
    quantity_span: Span | None
    ungrounded: tuple[str, ...]
    date: date | None
    planting_date: date | None

    @property
    def grounded(self) -> bool:
        return not self.ungrounded


def verify_entries(
    entries: tuple[ExtractedEntry, ...], transcript: str, recorded_on: "date"
) -> tuple[VerifiedEntry, ...]:
    """Ground every entry in the transcript and resolve its dates in code.

    ``recorded_on`` is the recording date; ``engine.resolve_date`` turns the model's
    expression into a calendar date (or ``None`` when it cannot be resolved, which the
    UI shows for review instead of guessing).

    Guard (a) runs here: when ``date_expr`` equals ``planting_date_expr`` and the
    transcript holds no separate date phrase for the observation, ``date_expr`` becomes
    ``None`` (the entry then defaults to the recording date, as PLAN.md says).
    """
    phrase_count = observation_date_phrase_count(transcript)
    verified: list[VerifiedEntry] = []
    for entry in entries:
        grounding = ground_entry(entry, transcript)
        date_expr = guard_duplicate_date(entry, phrase_count)
        verified.append(
            VerifiedEntry(
                plot=entry.plot,
                crop=entry.crop,
                kind=entry.kind,
                text=entry.text,
                quantity=entry.quantity,
                date_expr=date_expr,
                planting_date_expr=entry.planting_date_expr,
                plot_span=grounding.plot,
                crop_span=grounding.crop,
                quantity_span=grounding.quantity,
                ungrounded=grounding.ungrounded,
                date=resolve_date(date_expr, recorded_on),
                # Different rule from the entry date: no planting expression means
                # the planting date is *unknown*, not "today" (engine.resolve_date
                # returns the recording date for None, which is right for the entry
                # date and wrong for planting).
                planting_date=(
                    resolve_date(entry.planting_date_expr, recorded_on)
                    if entry.planting_date_expr is not None
                    else None
                ),
            )
        )
    return tuple(verified)


def needs_clarify(entries: tuple[VerifiedEntry, ...]) -> bool:
    """Guard (b): nothing anchors the note, so the app must ask before filing it.

    True when, after V1, **no** entry has a grounded plot **and** every entry's crop is
    null or a generic word (``GENERIC_CROP_WORDS``). The caller converts such a result
    to action ``clarify`` with the fixed question in ``pipeline.extract`` — the model's
    action is overridden by code (AGENTS.md rule 1), never by a second model call.
    """
    if not entries:
        return False
    for entry in entries:
        if entry.plot is not None and "plot" not in entry.ungrounded:
            return False  # at least one grounded plot anchors the note
        crop = normalize_with_map(entry.crop)[0] if entry.crop is not None else None
        if crop is not None and crop not in GENERIC_CROP_WORDS:
            return False  # a specific crop anchors the note
    return True
