import { logNetwork } from './db.js'

const loggedFetchJSON = async (url, options) => {
  const t0 = Date.now()
  const req = await fetch(url, options)
  const respText = await req.text()
  await logNetwork(url, options.body, respText, Date.now() - t0)
  console.log(url, respText)
  return JSON.parse(respText)
}

const workAroundKeywords = (text) =>
  text.replaceAll('主席台', '讲台')
      .replaceAll('政治家', 'politician')
      .replaceAll('政治', 'politic')

const paint_CogView3Flash = async (text) => {
  const key = Deno.env.get('API_KEY_ZHIPU') || prompt('API key (Zhipu):')
  const imageResponse = await loggedFetchJSON('https://open.bigmodel.cn/api/paas/v4/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: 'cogview-3-flash',
      prompt: workAroundKeywords(text),
      size: '1024x1024',
    }),
  })

  const url = imageResponse.data[0].url
  return await (await fetch(url)).blob()
}

// const paint_provider = paint_CogView3Flash
const paint_provider = async (text) => {
  await new Promise((resolve, reject) => setTimeout(resolve, 2000))
  return text.toUpperCase()
}

const queue = []  // [[text, resolve, reject]; N]
let inProgressCount = 0

const arrange = () => {
  while (inProgressCount < 2 && queue.length > 0) {
    const [text, resolve, reject] = queue.shift()
    inProgressCount++
    console.log('arrange', text, inProgressCount)
    ;(async () => {
      try {
        const result = await paint_provider(text)
        console.log('resolve', text, result)
        resolve(result)
      } catch (e) {
        reject(e)
      }
      inProgressCount--
      arrange()
    })()
  }
}

export const paint = (text) => new Promise((resolve, reject) => {
  queue.push([text, resolve, reject])
  arrange()
})

console.log(await Promise.all([
  paint('aaa'),
  paint('bbb'),
  paint('ccc'),
  paint('ddd'),
  (async () => { await new Promise((resolve, reject) => setTimeout(resolve, 3000)); return await paint('eee') })(),
]))
