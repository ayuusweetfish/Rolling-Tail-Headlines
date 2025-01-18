import { Database } from 'jsr:@db/sqlite@0.12'

const db = new Database('fox.db')

const cachedStmts = {}
const stmt = (s) => (cachedStmts[s] || (cachedStmts[s] = db.prepare(s)))
const run = (s, ...a) => stmt(s).run(...a)

// Data models

;`
  CREATE TABLE IF NOT EXISTS issues (
    uuid TEXT NOT NULL PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    language TEXT NOT NULL
  ) WITHOUT ROWID;

  CREATE TABLE IF NOT EXISTS topics (
    issue_uuid TEXT NOT NULL,
    text_english TEXT NOT NULL,
    text_native TEXT NOT NULL,
    image BLOB,
    FOREIGN KEY (issue_uuid) REFERENCES issues (uuid)
  );

  CREATE TABLE IF NOT EXISTS published_issues (
    issue_num INTEGER PRIMARY KEY,
    issue_uuid TEXT NOT NULL,
    pages_content TEXT NOT NULL,
    FOREIGN KEY (issue_uuid) REFERENCES issues (uuid)
  );
`.split(/;\n\n+/).map((s) => db.prepare(s).run())

export const newEmptyIssue = async (uuid, timestamp, language) => {
  stmt(`INSERT INTO issues (uuid, timestamp, language) VALUES (?, ?, ?)`)
    .run(uuid, timestamp, language)
}

export const newTopics = async (issue_uuid, topics) => {
  for (const [text_english, text_native] of topics) {
    stmt(`INSERT INTO topics (issue_uuid, text_english, text_native)
          VALUES (?, ?, ?)`)
      .run(issue_uuid, text_english, text_native)
  }
}

// [[id, selected]; 6]
export const topicsForIssue = async (issue_uuid) => {
  // XXX: Cannot condense?
  const values =
    stmt(`SELECT rowid, (image IS NOT NULL) FROM topics WHERE issue_uuid = ?`)
      .values(issue_uuid)
  return values
}

export const getTopicEnglishText = async (topic_id) => {
  const value =
    stmt(`SELECT text_english FROM topics WHERE rowid = ?`)
      .value(topic_id)
  return value
}

export const markTopicAsSelected = async (topic_id) => {
  stmt(`UPDATE topics SET image = '+' WHERE rowid = ?`).run(topic_id)
}

export const setTopicImage = async (topic_id, image) => {
  stmt(`UPDATE topics SET image = ? WHERE rowid = ?`).run(image, topic_id)
}

// [native text; 3]
export const selectedTopicsForIssue = async (issue_uuid) => {
  const values =
    stmt(`SELECT text_native FROM topics WHERE issue_uuid = ? AND image IS NOT NULL
          ORDER BY rowid ASC`)
      .values(issue_uuid)
  return values.map((rowFields) => rowFields[0])
}

export const reserveIssueNumber = async (issue_uuid) => {
  const value =
    stmt(`INSERT INTO published_issues (issue_uuid, pages_content) VALUES (?, '') RETURNING issue_num`)
      .value(issue_uuid)
  return value[0]
}

export const publishIssue = async (issue_num, pages_content) => {
  stmt(`UPDATE published_issues SET pages_content = ? WHERE issue_num = ?`)
    .run(pages_content, issue_num)
}

// Logging

;`
  CREATE TABLE IF NOT EXISTS network (
    url TEXT,
    payload TEXT,
    response TEXT,
    time INTEGER
  );
`.split(/;\n\n+/).map((s) => db.prepare(s).run())
export const logNetwork = async (url, payload, response, time) => {
  stmt(`INSERT INTO network VALUES (?, ?, ?, ?)`)
    .run(url, payload, response, time)
}
