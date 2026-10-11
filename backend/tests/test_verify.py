"""V1 grounding: crop/plot/quantity must be found in the transcript, with spans.

Every expectation is written from the transcript by hand: each span is checked against
the actual substring it points at, not against a remembered offset.
"""

from __future__ import annotations

from datetime import date

from fieldtalk.engine import DateExpr, Quantity
from fieldtalk.pipeline import ExtractedEntry, ground_entry, verify_entries
from fieldtalk.pipeline.verify import normalize_numbers_with_map, normalize_with_map

RECORDED = date(2026, 10, 7)


def _entry(**overrides) -> ExtractedEntry:
    base: dict = {
        "plot": None,
        "crop": None,
        "kind": "observation",
        "text": "note",
        "date_expr": None,
        "planting_date_expr": None,
        "quantity": None,
    }
    base.update(overrides)
    return ExtractedEntry(**base)


def test_normalize_maps_every_character_back_to_the_original() -> None:
    original = "Plot two, MAIZE; watered!"
    normalized, offsets = normalize_with_map(original)
    assert normalized == "plot two maize watered"
    assert len(normalized) == len(offsets)
    for position in (0, 5, 10, 17):
        assert normalized[position] == original[offsets[position]].lower()


def test_grounds_plot_and_crop_with_real_spans() -> None:
    transcript = "Plot two, maize, planted on July tenth. Leaves are green."
    grounding = ground_entry(_entry(plot="plot two", crop="maize"), transcript)
    assert grounding.ungrounded == ()
    assert grounding.plot is not None and grounding.crop is not None
    assert transcript[grounding.plot[0]:grounding.plot[1]] == "Plot two"
    assert transcript[grounding.crop[0]:grounding.crop[1]] == "maize"


def test_grounded_values_ignore_case_and_punctuation() -> None:
    transcript = "At the Rice Plot, irrigation was checked."
    grounding = ground_entry(_entry(plot="rice plot", crop="Rice"), transcript)
    assert grounding.ungrounded == ()
    assert transcript[grounding.plot[0]:grounding.plot[1]] == "Rice Plot"
    assert transcript[grounding.crop[0]:grounding.crop[1]] == "Rice"


def test_unfound_crop_is_reported_not_dropped() -> None:
    transcript = "Plot two, the leaves are yellowing."
    grounding = ground_entry(_entry(plot="plot two", crop="soybean"), transcript)
    assert grounding.ungrounded == ("crop",)
    assert grounding.plot is not None
    assert grounding.crop is None
    assert grounding.grounded is False


def test_matches_whole_words_only() -> None:
    transcript = "The maize variety was checked."
    grounding = ground_entry(_entry(crop="mai"), transcript)
    assert grounding.ungrounded == ("crop",)


def test_quantity_value_and_unit_ground_together() -> None:
    transcript = "I harvested five baskets from the garden bed today."
    grounding = ground_entry(
        _entry(plot="garden bed", quantity=Quantity(value=5, unit="baskets")),
        transcript,
    )
    assert grounding.ungrounded == ()
    assert grounding.quantity is not None
    spanned = transcript[grounding.quantity[0]:grounding.quantity[1]]
    assert "five" in spanned and "baskets" in spanned


def test_quantity_grounds_when_the_number_is_written_as_digits() -> None:
    transcript = "Plot one, weeded this morning and used 2 hours."
    grounding = ground_entry(
        _entry(plot="plot one", quantity=Quantity(value=2, unit="hours")), transcript
    )
    assert grounding.ungrounded == ()
    assert "2 hours" in transcript[grounding.quantity[0]:grounding.quantity[1]]


def test_quantity_fails_when_the_number_is_absent() -> None:
    transcript = "I harvested five baskets."
    grounding = ground_entry(_entry(quantity=Quantity(value=7, unit="baskets")), transcript)
    assert grounding.ungrounded == ("quantity",)
    assert grounding.quantity is None


def test_quantity_fails_when_the_unit_is_absent() -> None:
    transcript = "I counted twelve plants."
    grounding = ground_entry(_entry(quantity=Quantity(value=12, unit="crates")), transcript)
    assert grounding.ungrounded == ("quantity",)


def test_number_normalization_produces_a_consistent_index_map() -> None:
    original = "I picked twenty one tomatoes"
    normalized, offsets = normalize_numbers_with_map(original)
    assert normalized == "i picked 21 tomatoes"
    assert len(normalized) == len(offsets)
    digit_start = normalized.index("21")
    # The digit 2 maps to the start of the word "twenty" in the original text.
    assert offsets[digit_start] == original.index("twenty")
    # Digits stand in for the words they replaced; every other character still
    # matches the original string.
    for position, offset in enumerate(offsets):
        if normalized[position] != " " and not normalized[position].isdigit():
            assert normalized[position] == original[offset].lower()


def test_verify_entries_resolves_dates_in_code() -> None:
    transcript = "Plot three, millet. Two days ago it rained, planted on July tenth."
    entries = (
        _entry(
            plot="plot three",
            crop="millet",
            date_expr=DateExpr("days_ago", n=2),
            planting_date_expr=DateExpr("month_day", month=7, day=10),
        ),
    )
    verified = verify_entries(entries, transcript, RECORDED)
    assert len(verified) == 1
    entry = verified[0]
    assert entry.date == date(2026, 10, 5), "days_ago 2 -> 2026-10-05, derived by hand"
    assert entry.planting_date == date(2026, 7, 10)
    assert entry.grounded is True


def test_verify_entries_defaults_a_missing_date_to_the_recording_date() -> None:
    verified = verify_entries((_entry(plot="plot one"),), "Plot one.", RECORDED)
    assert verified[0].date == RECORDED
    assert verified[0].planting_date is None
