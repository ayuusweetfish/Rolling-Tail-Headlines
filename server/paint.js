import { logNetwork } from './db.js'
import sharp from 'npm:sharp@0.33.5'  // Ignore Deno's warning about NPM lifecycle scripts

// `input`: ArrayBuffer | TypedArray | node:Buffer | string
// Returns node:Buffer (which extends Uint8Array)
const normalizeImage = async (input) => {
  const alpha = await sharp(input).gamma().greyscale()
    .normalise({ lower: 5, upper: 95 })
    .negate().resize(512, 512)
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
  await logNetwork(url, options.body || '', respText, Date.now() - t0)
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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const paintQueued = (taskCreateFn, taskStatusFn) => async (text) => {
  const taskId = await taskCreateFn(text)
  console.log(`Task ID: ${taskId}`)

  while (true) {
    const bufferResp = await taskStatusFn(taskId)
    if (bufferResp) {
      const blob = await bufferResp.blob()
      return await normalizeImage(await blob.arrayBuffer())
    }
    await delay(1000)
  }
}

const paint_Wanx21Turbo = paintQueued(async (text) => {
  const key = Deno.env.get('API_KEY_ALIYUN') || prompt('API key (Aliyun Bailian):')
  const imageResponse = await loggedFetchJSON(
    'https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer' + key,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model: 'wanx2.1-t2i-turbo',
        input: { prompt: workAroundKeywords(text) },
        parameters: { size: '1024*1024', n: 1, prompt_extend: false },
      }),
    }
  )
  return imageResponse.output.task_id
}, async (taskId) => {
  const key = Deno.env.get('API_KEY_ALIYUN') || prompt('API key (Aliyun Bailian):')
  const statusResponse = await loggedFetchJSON(
    `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer' + key,
      },
    }
  )
  if (statusResponse.output.task_status === 'SUCCEEDED') {
    return await fetch(statusResponse.output.results[0].url)
  } else if (
    statusResponse.output.task_status !== 'PENDING' &&
    statusResponse.output.task_status !== 'RUNNING'
  ) {
    throw new Error('Image task failed')
  }
  return null
})

const endpoint_FoxNN = Deno.env.get('ENDPOINT_FOXNN') || 'http://localhost:26220'
const key_FoxNN = Deno.env.get('API_KEY_FOXNN') || prompt('API key (FoxNN):')
const paint_FoxNN = paintQueued(async (text) => {
  const resp = await loggedFetchJSON(
    `${endpoint_FoxNN}/paint`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key_FoxNN}`,
        'Host': 'paint.fox.ayu.land',
      },
      body: JSON.stringify({ prompt: text }),
    }
  )
  if (!resp.task_id) {
    throw new Error(`Cannot create image task: ${resp.message}`)
  }
  return resp.task_id
}, async (taskId) => {
  const statusResponse = await loggedFetchJSON(
    `${endpoint_FoxNN}/status/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key_FoxNN}`,
      },
    }
  )
  if (statusResponse.status === 'finished') {
    return await fetch(
      `${endpoint_FoxNN}/result/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${key_FoxNN}`,
        },
      }
    )
  } else if (statusResponse.status === 'error') {
    throw new Error(`Image task failed: ${statusResponse.message}`)
  }
  return null
})

const paint_provider =
  paint_FoxNN
  // paint_Wanx21Turbo
  // paint_CogView3Flash
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

// ======== Test run ======== //
if (import.meta.main) {
  // await Deno.writeFile('1.webp', await paint('黑白简笔画卡通平涂风格，线条流畅、圆润、简洁，有手绘风格。画面中，一位穿着简单的人类角色，头戴一顶小帽子，身上系着多个小铃铛，正在森林中行走。周围有几只小动物，如兔子、松鼠和小鸟，好奇地围着他。背景为简单的树木和草地轮廓，使用粗线条和大色块，可加入灰色阴影，使整张图简洁、可爱。小尺寸阅览友好。'))
  await Deno.writeFile('1.webp', await paint('A hand-drawn black and white ink illustration of a cheerful girl walking through a whimsical forest, wearing a hat with bunny ears and a dress decorated with a string of hanging bells, surrounded by cute animals like squirrels, rabbits, and birds. Cartoon style, childlike charm, storybook aesthetic, line art, playful and nostalgic mood, ink wash.'))
}
