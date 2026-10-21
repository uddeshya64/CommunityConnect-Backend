import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { AiEventService, normaliseExtraction } from "../services/aiEvent.service";
import {
  extractEventFromText,
  extractSchedule,
  parseTimeOfDay,
} from "../utils/eventTextExtractor";
import {
  buildClarificationQuestions,
  computeMissingFields,
  mergeDraft,
  normaliseEventType,
  validateEventDraft,
  type EventDraftValues,
} from "../utils/eventDraft";

/**
 * Fixed clock and UTC offset so spoken times resolve deterministically,
 * regardless of the machine running the tests.
 */
const NOW = new Date("2026-09-27T09:00:00.000Z"); // a Sunday
const OPTS = { now: NOW, timeZoneOffsetMinutes: 0 };

const COMPLETE_DRAFT: EventDraftValues = {
  title: "Blood Donation Camp",
  description: "Community blood donation camp organised with the local NGO",
  type: "Community and Nonprofit Events",
  mode: "offline",
  start_date: "2026-10-15T04:30:00.000Z",
  end_date: "2026-10-15T10:30:00.000Z",
  registration_type: "solo",
  registration_fee: 0,
  min_team_size: 1,
  max_team_size: 1,
};

describe("text extractor: times", () => {
  it("parses 12 and 24 hour times", () => {
    assert.deepEqual(parseTimeOfDay("10:30 am"), { hours: 10, minutes: 30 });
    assert.deepEqual(parseTimeOfDay("7 pm"), { hours: 19, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("12 am"), { hours: 0, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("12 pm"), { hours: 12, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("18:45"), { hours: 18, minutes: 45 });
  });

  it("rejects impossible values", () => {
    assert.equal(parseTimeOfDay("25:00"), null);
    assert.equal(parseTimeOfDay("10:75"), null);
  });

  it("parses meridiems that speech-to-text glues to the digits", () => {
    // A \b before the meridiem never matches "6pm", which silently turned 6pm into
    // 06:00 and made an 18:00 end time look earlier than its start.
    assert.deepEqual(parseTimeOfDay("6pm"), { hours: 18, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("10am"), { hours: 10, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("10pm"), { hours: 22, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("12am"), { hours: 0, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("7:05pm"), { hours: 19, minutes: 5 });
    assert.deepEqual(parseTimeOfDay("6pm"), { hours: 18, minutes: 0 });
  });

  it("parses dotted meridiems", () => {
    assert.deepEqual(parseTimeOfDay("6 p.m."), { hours: 18, minutes: 0 });
    assert.deepEqual(parseTimeOfDay("6p.m."), { hours: 18, minutes: 0 });
  });
});

describe("text extractor: schedule", () => {
  it("understands 'from X to Y' on an explicit date", () => {
    const schedule = extractSchedule(
      "on 15 October 2026 from 10 am to 4 pm",
      OPTS
    );

    assert.equal(schedule.start_date, "2026-10-15T10:00:00.000Z");
    assert.equal(schedule.end_date, "2026-10-15T16:00:00.000Z");
  });

  it("understands ISO dates", () => {
    const schedule = extractSchedule("event on 2026-10-15 at 09:30", OPTS);

    assert.equal(schedule.start_date, "2026-10-15T09:30:00.000Z");
  });

  it("understands day-first numeric dates", () => {
    const schedule = extractSchedule("15/10/2026 10am", OPTS);

    assert.equal(schedule.start_date?.slice(0, 10), "2026-10-15");
  });

  it("understands month-first named dates", () => {
    const schedule = extractSchedule("October 15, 2026 at 6 pm", OPTS);

    assert.equal(schedule.start_date, "2026-10-15T18:00:00.000Z");
  });

  it("resolves relative dates against the current date", () => {
    const schedule = extractSchedule("tomorrow at 5 pm", OPTS);

    assert.equal(schedule.start_date?.slice(0, 10), "2026-09-28");
    assert.equal(schedule.end_date?.slice(0, 10), "2026-09-28");
  });

  it("resolves 'next friday'", () => {
    // 2026-09-27 is a Sunday, so the next Friday is 2026-10-02.
    const schedule = extractSchedule("next Friday", OPTS);

    assert.equal(schedule.start_date?.slice(0, 10), "2026-10-02");
  });

  it("uses a two day range when two dates are given", () => {
    const schedule = extractSchedule(
      "from 15 October 2026 to 17 October 2026",
      OPTS
    );

    assert.equal(schedule.start_date?.slice(0, 10), "2026-10-15");
    assert.equal(schedule.end_date?.slice(0, 10), "2026-10-17");
  });

  it("keeps a glued 6pm end time at 18:00 instead of shifting it to start + 3h", () => {
    const schedule = extractSchedule("15 October 2026 10am-6pm", OPTS);

    assert.equal(schedule.start_date, "2026-10-15T10:00:00.000Z");
    assert.equal(schedule.end_date, "2026-10-15T18:00:00.000Z");
  });

  it("prefers an explicit from/to range on an explicit date", () => {
    const schedule = extractSchedule(
      "on 15 October 2026 from 10am to 6pm",
      OPTS
    );

    assert.equal(schedule.start_date, "2026-10-15T10:00:00.000Z");
    assert.equal(schedule.end_date, "2026-10-15T18:00:00.000Z");
  });

  it("always returns an end after the start", () => {
    const schedule = extractSchedule("on 15 October 2026 at 6 pm to 4 pm", OPTS);

    assert.ok(
      new Date(schedule.end_date!).getTime() >
        new Date(schedule.start_date!).getTime()
    );
  });

  it("resolves spoken times in the organiser's timezone, not the server's", () => {
    // IST is UTC+05:30, so `getTimezoneOffset()` is -330.
    const ist = { now: NOW, timeZoneOffsetMinutes: -330 };

    const schedule = extractSchedule("on 15 October 2026 from 10 am to 4 pm", ist);

    assert.equal(schedule.start_date, "2026-10-15T04:30:00.000Z");
    assert.equal(schedule.end_date, "2026-10-15T10:30:00.000Z");
  });
});

describe("text extractor: event fields", () => {
  it("extracts a full blood donation camp description", () => {
    const patch = extractEventFromText(
      "We are organising a blood donation camp called Sehat Samaroh on 15th October 2026 from 10 am to 4 pm at Community Hall, Indore. Entry is free and teams of up to 4 can participate. Capacity is 120 people.",
      OPTS
    );

    assert.match(String(patch.title), /Sehat Samaroh/);
    assert.equal(patch.type, "Community and Nonprofit Events");
    assert.equal(patch.mode, "offline");
    assert.equal(patch.start_date, "2026-10-15T10:00:00.000Z");
    assert.equal(patch.end_date, "2026-10-15T16:00:00.000Z");
    assert.match(String(patch.location), /Community Hall/);
    assert.equal(patch.capacity, 120);
    assert.equal(patch.registration_fee, 0);
    assert.equal(patch.registration_type, "team");
    assert.equal(patch.max_team_size, 4);
    assert.ok(String(patch.description).length >= 20);
  });

  it("fills team sizes for a solo event so it can pass validation", () => {
    const patch = extractEventFromText("solo entry", OPTS);

    assert.equal(patch.registration_type, "solo");
    assert.equal(patch.min_team_size, 1);
    assert.equal(patch.max_team_size, 1);
  });

  it("detects an online event", () => {
    const patch = extractEventFromText(
      "A free webinar on AI on 2026-10-20 at 6 pm, hosted on Zoom, solo entry",
      OPTS
    );

    assert.equal(patch.mode, "online");
    assert.equal(patch.type, "Hybrid and Virtual Events");
    assert.equal(patch.registration_fee, 0);
    assert.equal(patch.registration_type, "solo");
  });

  it("detects a hybrid event when both signals are present", () => {
    const patch = extractEventFromText(
      "Hybrid meetup: online on Zoom and offline at the campus auditorium on 2026-10-20",
      OPTS
    );

    assert.equal(patch.mode, "hybrid");
  });

  it("treats the word 'hybrid' as decisive even when a venue is named", () => {
    // Neither hint regex contains the word "hybrid", so a venue used to win and the
    // event came back as offline.
    const patch = extractEventFromText(
      "a hybrid event called TechFusion on 15 October 2026 from 10am to 6pm at Community Hall Indore, entry is free, solo registration, capacity 250",
      OPTS
    );

    assert.equal(patch.mode, "hybrid");
    assert.equal(patch.capacity, 250);
    assert.match(String(patch.title), /TechFusion/);
    assert.equal(patch.end_date, "2026-10-15T18:00:00.000Z");
  });

  it("derives a short title instead of echoing the whole prompt", () => {
    assert.equal(
      extractEventFromText(
        "online workshop on 20 November 2026 9am-5pm capacity 80",
        OPTS
      ).title,
      "Online workshop"
    );
    assert.equal(
      extractEventFromText(
        "we are organizing a blood donation camp on 3 January 2027 from 9am to 1pm at City Hospital, free entry",
        OPTS
      ).title,
      "Blood donation camp"
    );
    assert.equal(
      extractEventFromText(
        "Annual charity run 2027-03-14 6:00am-9:00am for 250 participants",
        OPTS
      ).title,
      "Annual charity run"
    );
  });

  it("extracts a paid entry fee in several formats", () => {
    assert.equal(
      extractEventFromText("entry fee \u20b9500", OPTS).registration_fee,
      500
    );
    assert.equal(
      extractEventFromText("registration costs Rs 250 per person", OPTS)
        .registration_fee,
      250
    );
    assert.equal(
      extractEventFromText("500 rupees entry", OPTS).registration_fee,
      500
    );
    assert.equal(
      extractEventFromText("free of cost", OPTS).registration_fee,
      0
    );
  });

  it("extracts team size ranges", () => {
    const patch = extractEventFromText(
      "teams of 3 to 5 members are allowed",
      OPTS
    );

    assert.equal(patch.registration_type, "team");
    assert.equal(patch.min_team_size, 3);
    assert.equal(patch.max_team_size, 5);
  });

  it("recognises hackathons, training and sports events", () => {
    assert.equal(
      extractEventFromText("a 24 hour hackathon", OPTS).type,
      "Hackathons and Competitions"
    );
    assert.equal(
      extractEventFromText("a python training workshop for students", OPTS).type,
      "Academic and Training Events"
    );
    assert.equal(
      extractEventFromText("the district cricket tournament", OPTS).type,
      "Sports and Recreational Events"
    );
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(extractEventFromText("", OPTS), {});
    assert.deepEqual(extractEventFromText("   ", OPTS), {});
  });

  it("derives a title when none is stated", () => {
    const patch = extractEventFromText(
      "We are organising a tree plantation drive this Saturday",
      OPTS
    );

    assert.ok(String(patch.title).length >= 3);
    assert.ok(String(patch.title).length <= 150);
  });

  it("drops request phrasing and logistics from the title", () => {
    assert.equal(
      extractEventFromText(
        "Create a event for the Diwali celebration on 31 October 2026 at 6 pm to 8 pm",
        OPTS
      ).title,
      "Diwali celebration"
    );
    assert.equal(
      extractEventFromText(
        "we want to host a Christmas party on 25 December 2026 7pm to 11pm",
        OPTS
      ).title,
      "Christmas party"
    );
  });

  it("keeps a real title that starts with a creation verb", () => {
    assert.equal(
      extractEventFromText(
        "Create a Startup Bootcamp on 5 May 2027 from 10am to 4pm capacity 100",
        OPTS
      ).title,
      "Startup Bootcamp"
    );
  });

  it("classifies festivals and celebrations", () => {
    assert.equal(
      extractEventFromText(
        "Create a event for the Diwali celebration on 31 October 2026 at 6 pm to 8 pm",
        OPTS
      ).type,
      "Community and Nonprofit Events"
    );
    // A wedding celebration must not be captured by the festival keywords.
    assert.equal(
      extractEventFromText("wedding celebration on 12 May 2027", OPTS).type,
      "Weddings and Personal Events"
    );
  });

  it("recovers a mis-spelled month name", () => {
    const schedule = extractSchedule(
      "Create a event for the Diwali celebration on 31 ocyt2026 at 6 pm to 8 pm",
      OPTS
    );

    assert.equal(schedule.start_date, "2026-10-31T18:00:00.000Z");
    assert.equal(schedule.end_date, "2026-10-31T20:00:00.000Z");
  });

  it("does not invent a date out of ordinary words", () => {
    const schedule = extractSchedule("meet for 3 cats and 5 dogs", OPTS);

    assert.equal(schedule.start_date, undefined);
    assert.equal(schedule.end_date, undefined);
  });

  it("handles a spoken transcription with filler and a typo", () => {
    const patch = extractEventFromText(
      "Created Diwali celebration event Or 21st October 2026 at 6 PM to 8 PM it's Is Team events and Also its capacity of the event is 5",
      OPTS
    );

    assert.equal(patch.title, "Diwali celebration");
    assert.equal(patch.type, "Community and Nonprofit Events");
    assert.equal(patch.start_date, "2026-10-21T18:00:00.000Z");
    assert.equal(patch.end_date, "2026-10-21T20:00:00.000Z");
    assert.equal(patch.capacity, 5);
    assert.equal(patch.registration_type, "team");
  });

  it("reads a capacity stated as 'the capacity of the event is N'", () => {
    assert.equal(
      extractEventFromText("the capacity of the event is 250", OPTS).capacity,
      250
    );
    assert.equal(
      extractEventFromText("capacity of the event is 5", OPTS).capacity,
      5
    );
  });

  it("keeps words that are part of a name", () => {
    assert.equal(
      extractEventFromText("Team Building Workshop on 4 April 2027", OPTS).title,
      "Team Building Workshop"
    );
    assert.equal(
      extractEventFromText("Code for Cause on 2 May 2027", OPTS).title,
      "Code for Cause"
    );
    assert.equal(
      extractEventFromText("Createathon 5K on 4 April 2027", OPTS).title,
      "Createathon 5K"
    );
  });
});

describe("eventDraft: missing information", () => {
  it("reports every missing required field for an empty draft", () => {
    const missing = computeMissingFields({});

    for (const key of [
      "title",
      "description",
      "type",
      "mode",
      "start_date",
      "end_date",
      "registration_type",
      "registration_fee",
      "min_team_size",
      "max_team_size",
    ]) {
      assert.ok(missing.includes(key), `expected ${key} to be missing`);
    }
  });

  it("does not require optional fields", () => {
    const missing = computeMissingFields(COMPLETE_DRAFT);

    assert.ok(!missing.includes("location"));
    assert.ok(!missing.includes("capacity"));
    assert.equal(missing.length, 0);
  });

  it("treats blank strings as missing", () => {
    const missing = computeMissingFields({ ...COMPLETE_DRAFT, title: "   " });

    assert.deepEqual(missing, ["title"]);
  });

  it("rejects an unknown mode value", () => {
    const missing = computeMissingFields({ ...COMPLETE_DRAFT, mode: "virtual" });

    assert.deepEqual(missing, ["mode"]);
  });

  it("rejects an unparseable date", () => {
    const missing = computeMissingFields({
      ...COMPLETE_DRAFT,
      start_date: "sometime next year",
    });

    assert.deepEqual(missing, ["start_date"]);
  });

  it("builds one clarification question per missing field", () => {
    const questions = buildClarificationQuestions({});

    assert.equal(questions.length, computeMissingFields({}).length);
    assert.ok(questions.every((question) => question.length > 10));
  });
});

describe("eventDraft: merging and normalisation", () => {
  it("ignores null, undefined and blank incoming values", () => {
    const merged = mergeDraft<EventDraftValues>(
      { title: "Keep me", description: "Keep me too" },
      { title: "New", description: "", location: null }
    );

    assert.equal(merged.title, "New");
    assert.equal(merged.description, "Keep me too");
    assert.equal(merged.location, undefined);
  });

  it("maps free-form categories onto the existing event type names", () => {
    assert.equal(
      normaliseEventType("hackathon"),
      "Hackathons and Competitions"
    );
    assert.equal(
      normaliseEventType("Sports and Recreational Events"),
      "Sports and Recreational Events"
    );
    assert.equal(normaliseEventType("Blood drive"), "Blood drive");
  });

  it("caps the type at the 50 char column limit", () => {
    assert.ok(normaliseEventType("x".repeat(120)).length <= 50);
  });
});

describe("eventDraft: validation reuses CreateEventSchema", () => {
  it("accepts a valid event and coerces the dates", () => {
    const result = validateEventDraft(COMPLETE_DRAFT);

    assert.equal(result.valid, true);
    assert.ok(result.event?.start_date instanceof Date);
    assert.equal(result.event?.registration_fee, 0);
  });

  it("rejects a short title with the existing message", () => {
    const result = validateEventDraft({ ...COMPLETE_DRAFT, title: "Abc" });

    assert.equal(result.valid, false);
    assert.match(result.errors.title[0], /at least 5 characters/i);
  });

  it("rejects a short description with the existing message", () => {
    const result = validateEventDraft({ ...COMPLETE_DRAFT, description: "short" });

    assert.equal(result.valid, false);
    assert.match(result.errors.description[0], /detailed/i);
  });

  it("rejects an end date that is not after the start date", () => {
    const result = validateEventDraft({
      ...COMPLETE_DRAFT,
      end_date: "2026-10-15T04:00:00.000Z",
    });

    assert.equal(result.valid, false);
    assert.match(result.errors.end_date[0], /after start date/i);
  });

  it("rejects a negative registration fee", () => {
    const result = validateEventDraft({
      ...COMPLETE_DRAFT,
      registration_fee: -5,
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.registration_fee);
  });

  it("rejects a banner url that is not a url", () => {
    const result = validateEventDraft({
      ...COMPLETE_DRAFT,
      banner_url: "not-a-url",
    });

    assert.equal(result.valid, false);
    assert.ok(result.errors.banner_url);
  });

  it("lists the still-missing fields alongside the errors", () => {
    const { title, description, ...rest } = COMPLETE_DRAFT;
    const result = validateEventDraft(rest);

    assert.equal(result.valid, false);
    assert.ok(result.missing_fields.includes("title"));
    assert.ok(result.missing_fields.includes("description"));
  });
});

describe("aiEvent service: normaliseExtraction", () => {
  it("coerces numeric strings from the model", () => {
    const patch = normaliseExtraction({ capacity: "120", registration_fee: "0" });

    assert.equal(patch.capacity, 120);
    assert.equal(patch.registration_fee, 0);
  });

  it("normalises dates to ISO", () => {
    const patch = normaliseExtraction({
      start_date: "2026-10-15T10:00:00.000Z",
      end_date: "not-a-date",
    });

    assert.equal(patch.start_date, "2026-10-15T10:00:00.000Z");
    assert.equal(patch.end_date, "not-a-date");
  });

  it("ignores keys that are not event fields", () => {
    const patch = normaliseExtraction({ secret: "value", id: 7 });

    assert.deepEqual(patch, {});
  });

  it("keeps team sizes coherent", () => {
    const patch = normaliseExtraction({
      registration_type: "team",
      min_team_size: 8,
      max_team_size: 4,
    });

    assert.equal(patch.max_team_size, 4);
    assert.equal(patch.min_team_size, 1);
  });

  it("moves the end date after the start date when needed", () => {
    const patch = normaliseExtraction({
      start_date: "2026-10-15T10:00:00.000Z",
      end_date: "2026-10-15T09:00:00.000Z",
    });

    assert.ok(
      new Date(patch.end_date!).getTime() >
        new Date(patch.start_date!).getTime()
    );
  });

  it("ignores an unknown mode", () => {
    const patch = normaliseExtraction({ mode: "telepathy" });

    assert.equal(patch.mode, undefined);
  });
});

describe("aiEvent service: converse (local provider)", () => {
  it("extracts fields and asks for what is still missing", async () => {
    const result = await AiEventService.converse({
      message: "I want to organise a blood donation camp next month.",
      draft: {},
      knownTypes: [],
    });

    assert.equal(result.source, "local");
    assert.ok(result.extracted.description);
    assert.equal(result.extracted.type, "Community and Nonprofit Events");
    assert.ok(result.missing_fields.length > 0);
    assert.ok(result.questions.length > 0);
    assert.equal(result.complete, false);
  });

  it("completes the draft from a single fully described event", async () => {
    const result = await AiEventService.converse({
      message:
        "Blood donation camp called Sehat on 15 October 2026 from 10 am to 4 pm at Community Hall Indore, free entry, solo, capacity 80.",
      draft: {},
      knownTypes: [],
      timeZoneOffsetMinutes: 0,
    });

    assert.deepEqual(result.missing_fields, []);
    assert.equal(result.complete, true);
    assert.equal(result.draft.mode, "offline");
    assert.equal(result.draft.registration_fee, 0);
  });

  it("still produces a title when the provider is unavailable", async () => {
    // A rate-limited provider used to leave the title as "New Event", because the
    // transcript-derived title had been given up in favour of the provider's.
    const result = await AiEventService.converse({
      message:
        "Created Diwali celebration event on 21st October 2026 at 6 PM to 8 PM it is a team event and the capacity of the event is 5",
      draft: {},
      knownTypes: [],
      timeZoneOffsetMinutes: 0,
    });

    assert.equal(result.draft.title, "Diwali celebration");
    assert.equal(result.draft.type, "Community and Nonprofit Events");
    assert.equal(result.draft.capacity, 5);
    assert.equal(result.draft.registration_type, "team");
    assert.equal(result.draft.end_date, "2026-10-21T20:00:00.000Z");
  });

  it("asks for a team size instead of assuming one person per team", async () => {
    const result = await AiEventService.converse({
      message:
        "Created Diwali celebration event on 21st October 2026 at 6 PM to 8 PM it is a team event and the capacity of the event is 5",
      draft: {},
      knownTypes: [],
      timeZoneOffsetMinutes: 0,
    });

    assert.equal(result.draft.registration_type, "team");
    assert.equal(result.draft.max_team_size, undefined);
    assert.ok(result.missing_fields.includes("max_team_size"));
  });

  it("keeps values collected in earlier turns", async () => {
    const first = await AiEventService.converse({
      message: "Hackathon called Build For Bharat on 2026-12-01 at 10 am",
      draft: { location: "IIT Delhi" },
    });

    assert.equal(first.draft.location, "IIT Delhi");
    assert.equal(first.draft.type, "Hackathons and Competitions");
  });

  it("produces a reply that contains the clarification questions", async () => {
    const result = await AiEventService.converse({
      message: "Some event",
      draft: {},
    });

    assert.ok(result.reply.length > 0);
    assert.ok(result.questions.every((q) => result.reply.includes(q)));
  });
});
