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

// Returns `recent_issues` * 3 + `past_issues` topics (may be less if bootstrapping)
export const recentAndPastTopics = async (recent_issues, past_issues) => {
  const last_issue =
    stmt(`SELECT MAX(issue_num) FROM published_issues`).value() || 0

  // Topics from the most recent issues
  const recent_issues_topics =
    stmt(`SELECT text_english FROM topics
          JOIN published_issues ON topics.issue_uuid = published_issues.issue_uuid
          WHERE issue_num >= ? AND image IS NOT NULL`)
      .values(last_issue - recent_issues + 1)
      .map((rowFields) => rowFields[0])

  // Topics from further past issues
  // Sample without replacement, total = `last_issue` - `recent_issues`, take = `past_issues`,
  // with Floyd's algorithm described in "Programming pearls: a sample of brilliance".
  // wren-lang/wren#716 ^ ^
  const N = last_issue - recent_issues
  const past_issues_nums = []
  const past_issues_nums_map = {}
  for (let i = Math.max(0, N - past_issues); i < N; i++) {
    let x = Math.floor(Math.random() * (i + 1))
    if (past_issues_nums_map[x]) x = i
    past_issues_nums.push(x)
    past_issues_nums_map[x] = true
  }
  const past_issues_topics = past_issues_nums.map((n) =>
    stmt(`SELECT text_english FROM topics
          JOIN published_issues ON topics.issue_uuid = published_issues.issue_uuid
          WHERE issue_num = ? AND image IS NOT NULL
          ORDER BY RANDOM() LIMIT 1`)
      .value(n + 1)[0]
  )

  return [...past_issues_topics, ...recent_issues_topics]
}

export const topicImage = async (issue_num, topic_num) => {
  const value =
    stmt(`SELECT image FROM topics
          JOIN published_issues ON topics.issue_uuid = published_issues.issue_uuid
          WHERE issue_num = ? AND image IS NOT NULL
          ORDER BY topics.rowid ASC LIMIT 1 OFFSET ?`)
      .values(issue_num, topic_num)
  return value[0]
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

export const issuePagesContent = async (issue_num) => {
  const value =
    stmt(`SELECT pages_content FROM published_issues WHERE issue_num = ?`)
      .value(issue_num)
  return (value ? value[0] : null)
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
