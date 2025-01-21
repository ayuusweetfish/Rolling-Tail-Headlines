import { logNetwork } from './db.js'
import sharp from 'npm:sharp' // Ignore Deno's warning about NPM lifecycle scripts

// `input`: ArrayBuffer | TypedArray | node:Buffer | string
// Returns node:Buffer (which extends Uint8Array)
const normalizeImage = async (input) => {
  const alpha = await sharp(input).gamma().greyscale().negate().resize(512, 512)
    .extractChannel(0).toBuffer()
  const output = await sharp({ create: {
    width: 512, height: 512, channels: 3, background: { r: 0, g: 0, b: 0 }
  } }).greyscale().joinChannel(alpha, { width: 512, height: 512 })
  return await output.webp({ alphaQuality: 80 }).toBuffer()
}

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
  const blob = await (await fetch(url)).blob()
  return await normalizeImage(await blob.arrayBuffer())
}

const paint_provider = paint_CogView3Flash
const paintConcurrency = 2

const queue = []  // [[text, resolve, reject]; N]
let inProgressCount = 0

const arrange = () => {
  // Defer async function execution, in case of theoretically possible infinite recursion
  const sentToWork = []

  while (inProgressCount < paintConcurrency && queue.length > 0) {
    const [text, resolve, reject] = queue.shift()
    inProgressCount++
    sentToWork.push(async () => {
      try {
        const result = await paint_provider(text)
        resolve(result)
      } catch (e) {
        reject(e)
      }
      inProgressCount--
      arrange()
    })
  }

  for (const f of sentToWork) f()
}

export const paint = (text) => new Promise((resolve, reject) => {
  queue.push([text, resolve, reject])
  arrange()
})
