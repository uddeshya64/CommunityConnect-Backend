import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  buildEventCsvFilename,
  escapeCsvValue,
  parseCsvRows,
  parseEventCsv,
  stringifyEventCsv,
  toCsvBuffer,
  toIsoDateTime,
  EVENT_CSV_COLUMNS,
} from "../utils/eventCsv";

const VALID_EVENT = {
  title: "Blood Donation Camp",
  description: "Community blood donation camp organised with the local NGO",
  type: "Community and Nonprofit Events",
  mode: "offline" as const,
  start_date: "2026-10-15T04:30:00.000Z",
  end_date: "2026-10-15T10:30:00.000Z",
  location: "Community Hall, Indore",
  capacity: 120,
  registration_type: "team",
  registration_fee: 0,
  min_team_size: 1,
  max_team_size: 4,
};

describe("eventCsv: escaping", () => {
  it("leaves plain values untouched", () => {
    assert.equal(escapeCsvValue("Health"), "Health");
    assert.equal(escapeCsvValue(42), "42");
    assert.equal(escapeCsvValue(0), "0");
  });

  it("escapes commas", () => {
    assert.equal(
      escapeCsvValue("Community Hall, Indore"),
      '"Community Hall, Indore"'
    );
  });

  it("doubles embedded quotes", () => {
    assert.equal(escapeCsvValue('He said "donate"'), '"He said ""donate"""');
  });

  it("escapes newlines and carriage returns", () => {
    assert.equal(escapeCsvValue("line1\nline2"), '"line1\nline2"');
    assert.equal(escapeCsvValue("line1\r\nline2"), '"line1\r\nline2"');
  });

  it("preserves unicode characters", () => {
    const value = "स्वास्थ्य 🩸 camp — Indore";
    assert.equal(escapeCsvValue(value), value);
  });

  it("serialises nullish values as empty cells", () => {
    assert.equal(escapeCsvValue(null), "");
    assert.equal(escapeCsvValue(undefined), "");
  });
});

describe("eventCsv: stringifyEventCsv", () => {
  it("uses the existing event schema column names as the header", () => {
    const csv = stringifyEventCsv([VALID_EVENT]);
    const header = csv.split("\r\n")[0];

    assert.equal(header, EVENT_CSV_COLUMNS.join(","));
    for (const column of [
      "title",
      "description",
      "type",
      "mode",
      "start_date",
      "end_date",
      "location",
      "capacity",
      "registration_type",
      "registration_fee",
      "min_team_size",
      "max_team_size",
    ]) {
      assert.ok(header.includes(column), `header is missing ${column}`);
    }
  });

  it("emits one header row plus one row per event, CRLF separated", () => {
    const csv = stringifyEventCsv([VALID_EVENT, { ...VALID_EVENT, title: "Second" }]);
    const rows = parseCsvRows(csv);

    assert.equal(rows.length, 3);
    assert.equal(rows[0][0], "event_id");
    assert.equal(rows[1][1], "Blood Donation Camp");
    assert.equal(rows[2][1], "Second");
  });

  it("round-trips commas, quotes, newlines and unicode", () => {
    const nasty = {
      ...VALID_EVENT,
      title: 'Camp "One", Phase #2',
      description: "Line one\nLine two, with a comma\r\nand a \"quote\" — plus 日本語",
    };

    const csv = stringifyEventCsv([nasty]);
    const { payloads, errors } = parseEventCsv(csv);

    assert.deepEqual(errors, []);
    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].title, nasty.title);
    assert.equal(payloads[0].description, nasty.description);
  });

  it("normalises Date values to ISO 8601", () => {
    const csv = stringifyEventCsv([
      { ...VALID_EVENT, start_date: new Date("2026-10-15T04:30:00.000Z") },
    ]);
    const { payloads } = parseEventCsv(csv);

    assert.equal(payloads[0].start_date, "2026-10-15T04:30:00.000Z");
  });

  it("serialises JSON columns as JSON documents", () => {
    const csv = stringifyEventCsv([
      { ...VALID_EVENT, custom_fields: { cause_purpose: "Health, awareness" } },
    ]);
    const { payloads } = parseEventCsv(csv);

    assert.deepEqual(payloads[0].custom_fields, {
      cause_purpose: "Health, awareness",
    });
  });

  it("coerces numeric columns back to numbers on parse", () => {
    const { payloads } = parseEventCsv(stringifyEventCsv([VALID_EVENT]));

    assert.equal(payloads[0].capacity, 120);
    assert.equal(payloads[0].registration_fee, 0);
    assert.equal(payloads[0].min_team_size, 1);
    assert.equal(payloads[0].max_team_size, 4);
  });

  it("encodes as UTF-8 and can add a BOM", () => {
    const csv = stringifyEventCsv([
      { ...VALID_EVENT, title: "स्वास्थ्य camp" },
    ]);

    const plain = toCsvBuffer(csv);
    assert.equal(plain[0], 0x65); // 'e' from "event_id"
    assert.ok(plain.toString("utf8").includes("स्वास्थ्य"));

    const withBom = toCsvBuffer(csv, { withBom: true });
    assert.deepEqual([...withBom.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    // A BOM must not break parsing.
    const { payloads } = parseEventCsv(withBom.toString("utf8"));
    assert.equal(payloads[0].title, "स्वास्थ्य camp");
  });
});

describe("eventCsv: parseEventCsv", () => {
  it("accepts header aliases used by spreadsheets", () => {
    const csv = [
      "Event Name,Category,Start,End,Venue,Fee",
      "Cleanup Drive,Community and Nonprofit Events,2026-11-02T05:00:00.000Z,2026-11-02T09:00:00.000Z,Gandhi Park,0",
    ].join("\n");

    const { payloads, errors } = parseEventCsv(csv);

    assert.deepEqual(errors, []);
    assert.equal(payloads[0].title, "Cleanup Drive");
    assert.equal(payloads[0].type, "Community and Nonprofit Events");
    assert.equal(payloads[0].location, "Gandhi Park");
    assert.equal(payloads[0].registration_fee, 0);
  });

  it("ignores unknown columns", () => {
    const csv = [
      "title,description,type,mode,start_date,end_date,secret_column",
      "Demo,A sufficiently long description,Technical Conferences,online,2026-01-01T00:00:00.000Z,2026-01-01T02:00:00.000Z,hide-me",
    ].join("\n");

    const { payloads } = parseEventCsv(csv);

    assert.equal(payloads[0].title, "Demo");
    assert.equal(payloads[0].secret_column, undefined);
  });

  it("rejects a file without a title column", () => {
    const { payloads, errors } = parseEventCsv("foo,bar\n1,2");

    assert.equal(payloads.length, 0);
    assert.match(errors[0].message, /title/);
  });

  it("reports an empty file", () => {
    const { errors } = parseEventCsv("");

    assert.match(errors[0].message, /empty/i);
  });

  it("skips blank rows and rows without a title", () => {
    const csv = [
      "title,type,mode,start_date,end_date,registration_type,registration_fee,min_team_size,max_team_size,description",
      ",Community Events,online,2026-01-01T00:00:00.000Z,2026-01-01T02:00:00.000Z,solo,0,1,1,no title here at all",
      ",,,,,",
      "Valid,Community Events,online,2026-01-01T00:00:00.000Z,2026-01-01T02:00:00.000Z,solo,0,1,1,a description that is long enough",
    ].join("\n");

    const { payloads, errors } = parseEventCsv(csv);

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].title, "Valid");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].row, 2);
  });
});

describe("eventCsv: filename", () => {
  it("builds a meaningful filename from the title and start date", () => {
    assert.equal(
      buildEventCsvFilename(VALID_EVENT),
      "blood-donation-camp-2026-10-15.csv"
    );
  });

  it("falls back when the title is unusable", () => {
    assert.equal(
      buildEventCsvFilename({ start_date: "" }),
      "community-connect-event.csv"
    );
  });

  it("strips characters that are unsafe in a filename", () => {
    const name = buildEventCsvFilename({
      title: '../../etc/passwd & "friends" <script>',
      start_date: "2026-01-05T00:00:00.000Z",
    });

    assert.match(name, /^[a-z0-9.-]+$/);
    assert.ok(!name.includes("/"));
    assert.ok(!name.includes(".."));
  });
});

describe("eventCsv: toIsoDateTime", () => {
  it("passes through unparseable text so validation can report it", () => {
    assert.equal(toIsoDateTime("not-a-date"), "not-a-date");
    assert.equal(toIsoDateTime(""), "");
  });

  it("normalises parseable input to ISO", () => {
    assert.equal(toIsoDateTime("2026-10-15"), "2026-10-15T00:00:00.000Z");
  });
});
