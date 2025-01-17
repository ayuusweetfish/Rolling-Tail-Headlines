import { Database } from 'jsr:@db/sqlite@0.12'

const db = new Database('fox.db')

db.prepare(`
  CREATE TABLE IF NOT EXISTS past_issues (
    timestamp INTEGER,
    topics TEXT,
    language TEXT,
    pages TEXT
  )
`).run()

db.prepare(`
  CREATE TABLE IF NOT EXISTS network (
    url TEXT,
    payload TEXT,
    response TEXT,
    time INTEGER
  )
`).run()

const stmtLogNetwork = db.prepare(`
  INSERT INTO network VALUES (?, ?, ?, ?)
`)
export const logNetwork = async (url, payload, response, time) => {
  stmtLogNetwork.run(url, payload, response, time)
}
