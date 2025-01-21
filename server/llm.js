import { logNetwork } from './db.js'
import { createEventSource } from 'npm:eventsource-client'
import { paint } from './paint.js'

const loggedFetchJSON = async (url, options) => {
  const t0 = Date.now()
  const req = await fetch(url, options)
  const respText = await req.text()
  await logNetwork(url, options.body, respText, Date.now() - t0)
  console.log(url, respText)
  return JSON.parse(respText)
}

const requestLLM_OpenAI = (endpoint, model, temperature, key) => async (messages, isStreaming) => {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      messages,
      max_tokens: 8000,
      temperature: temperature,
      stream: (isStreaming ? true : undefined),
    }),
  }

  if (isStreaming) {
    const t0 = Date.now()
    const es = createEventSource({ url: endpoint, ...options })
    let buffer = ''

    return {
      [Symbol.asyncIterator]: async function* () {
        const bufferCombined = []

        for await (const chunk of es) {
          bufferCombined.push(chunk.data)
          if (chunk.data === '[DONE]') break
          try {
            const payload = JSON.parse(chunk.data)
            const s = payload.choices[0].delta.content
            // Ensure horizontal rules are not broken
            // There are better ways to return other parts early,
            // but benefit is negligible latency at one point in time. So ignore that.
            if (s.match(/-[^\S\r\n]*$/)) buffer += s
            else {
              yield buffer + s
              buffer = ''
            }
          } catch (e) {
            break
          }
        }

        es.close()
        if (buffer) yield buffer
        await logNetwork(endpoint, options.body, bufferCombined.join('\n'), Date.now() - t0)
      }
    }

  } else {
    const resp = await loggedFetchJSON(endpoint, options)
    // Extract text
    if (!(resp.choices instanceof Array) ||
        resp.choices.length !== 1 ||
        typeof resp.choices[0] !== 'object' ||
        typeof resp.choices[0].message !== 'object' ||
        resp.choices[0].message.role !== 'assistant' ||
        typeof resp.choices[0].message.content !== 'string')
      throw new Error('Incorrect schema from AI')
    const text = resp.choices[0].message.content
    return [resp, text]
  }
}

const requestLLM_DeepSeek3 = requestLLM_OpenAI(
  'https://api.deepseek.com/chat/completions', 'deepseek-chat', 1.6,
  Deno.env.get('API_KEY_DEEPSEEK') || prompt('API key (DeepSeek):')
)
const requestLLM_GLM4 = requestLLM_OpenAI(
  'https://open.bigmodel.cn/api/paas/v4/chat/completions', 'glm-4-flash', 1.0,
  Deno.env.get('API_KEY_ZHIPU') || prompt('API key (Zhipu):')
)
const requestLLM_Spark = requestLLM_OpenAI(
  'https://spark-api-open.xf-yun.com/v1/chat/completions', 'generalv3.5', 1.6,
  Deno.env.get('API_KEY_SPARK') || prompt('API key (Spark):')
)

// Application-specific routines

const languageNames = {
  'en': ['English', 'English'],
  'zh-Hans': ['简体中文', 'Simplified Chinese'],
  'zh-Hant': ['正體中文', 'Traditional Chinese'],
  'hi': ['हिन्दी', 'Hindi'],
  'es': ['Español', 'Spanish'],
  'ar': ['اَلْعَرَبِيَّةُ', 'Modern Standard Arabic'],
  'fr': ['Français', 'French'],
  'bn': ['বাংলা', 'Bengali'],
  'pt': ['Português', 'Portuguese'],
  'ru': ['Русский', 'Russian'],
  'ur': ['اُردُو', 'Urdu'],
  'id': ['Bahasa Indonesia', 'Indonesian'],
  'de': ['Deutsch', 'German'],
  'ja': ['日本語', 'Japanese'],
  'pcm': ['Naijá', 'Nigerian Pidgin'],
  'mr': ['मराठी', 'Marathi'],
  'te': ['తెలుగు', 'Telugu'],
  'tr': ['Türkçe', 'Turkish'],
  'ha': ['Harshen Hausa', 'Hausa'],
  'ta': ['தமிழ்', 'Tamil'],
  'sw': ['Kiswahili', 'Swahili'],
  'vi': ['Tiếng Việt', 'Vietnamese'],
  'tl': ['Wikang Tagalog', 'Tagalog'],
  'pa': ['پنجابی', 'Punjabi'],
  'ko': ['한국어', 'Korean'],
  'fa': ['فارسی', 'Persian'],
  'jv': ['Basa Jawa', 'Javanese'],
  'it': ['Italiano', 'Italian'],
  'po': ['Polski', 'Polish'],
  'hu': ['Magyar nyelv', 'Hungarian'],
}

// Returns: [[English text, native text]; 6]
export const askForTopicSuggestions = async (previousTopics, language) => {
  if (!languageNames[language]) return null

  const [_, text] = await requestLLM_DeepSeek3([
    { role: 'user', content: `
In the 22nd century, foxes are the playful superpowers. They traverse the world on a daily basis and report on discoveries, social activities, and political/economical events through Fox Newroll Network (FoxNN).

What can the topics of the next issue be? List 6 of your absolute favourites. Write each as a simple, concise, short sentence; omit the source ("scientists", "FoxNN", "document", etc.), simply describe the core topic. Let your imagination go wild, get as novel as possible ^ ^ Cover diverse topics including nature, animal society, science, art, animals' relationship with humans, etc. Do not get fox-centric; be nature-/animal-centric instead. Focus on whimsicality.

Make your ideas concise, in a playful tone, while being refreshingly innovative. Reply with the short, simple sentences in a Markdown list, without extra formatting (bold/italic).${language == 'en' ? '' : ` Reply in **${languageNames[language][1]} (${languageNames[language][0]})**. After all 6, translate everything into English.`}

Past issues:
${previousTopics.map((s) => '- ' + s).join('\n')}
      `.trim() }
  ])

  const matches = [...text.matchAll(/^\s*(?:[-*]|[0-9]+\.)\s(.+)$/gm)]
    .map((s) => s[1].trim()).filter((s) => s !== '')

  if (language === 'en') {
    if (matches.length !== 6) throw new Error('Malformed response from AI')
    return matches.map((s) => [s, s])
  } else {
    if (matches.length !== 12) throw new Error('Malformed response from AI')
    return matches.slice(0, 6).map((s, i) => [matches[i + 6], s])
  }
}

export const askForNewspaper = async function* (language, issueNumber, topics) {
  const frontPagePrompt = `
In the 22nd century, foxes are the playful superpowers. They traverse the world on a daily basis, observing, and discovering through a mechanism known as 'heads or tails' (no, it's not coin flipping, just some fox magic outside of the reach of languages). Fox Newroll Network (FoxNN) is a news agent that regularly publishes reports obtained this way.

Please help the foxes finish the issue! Remember that this is a whimsical world, so don't treat them as breaking news, everything is just regular ^ ^ Please make a front page making an introduction to today's issue and then overviewing/outlining the contents (with pointers to the pages). Start with the header given below. Do not add another overall title (e.g. "Front Page: xxx" or "Today's Headlines: xxx"), but subtitles are allowed.

Header:
# **The Rolling Tails Gazette 🦊**
*22nd Century Edition* | *Issue ${issueNumber}* | *Fox Newroll Network*${
  language === 'en' ? '' : (
    `\n\nAfter the header in English, continue in **${languageNames[language][1]} (${languageNames[language][0]})**. `
    + (
      language.startsWith('zh') ? 'The title is translated as "九尾日报".' :
        'Please do not translate the title; use the origin English name.'
    )
  )
}

Today's topics:
- ${topics[0]} (Page 2)
- ${topics[1]} (Page 3)
- ${topics[2]} (Page 4)
  `.trim()

  // Filter out the repeated header
  const headerChunks = []
  let headerDone = false

  const frontPageTextChunks = []
  const frontPageStream = await requestLLM_DeepSeek3([
    { role: 'user', content: frontPagePrompt },
  ], true)
  for await (const s of frontPageStream) {
    if (!headerDone) {
      headerChunks.push(s)
      const headerCombined = headerChunks.join('')
      const m = headerCombined.match(/\*Fox Newroll Network\*\s*\n(?:^---[-\s]*)*(^[^-\n][\S\s]*\S[\S\s]*|^[^-\n\s])/m)
      if (m) {
        headerDone = true
        yield m[1]
        frontPageTextChunks.push(m[1])
      }
    } else {
      yield s
      frontPageTextChunks.push(s)
    }
  }

  yield '\n\n~~++ page separator ++~~\n\n'

  const frontPageText = frontPageTextChunks.join('')

  const innerPagesStream = await requestLLM_DeepSeek3([
    { role: 'user', content: frontPagePrompt },
    { role: 'assistant', content: frontPageText },
    { role: 'user', content: `Perfect! Then, please help the foxes finish the report! Start each page with a first-level title; use subtitles along the way if you feel the need. Do not include extra headers or footers; do not include the page number. Write at least a few paragraphs for each page. Separate each page with a horizontal rule (---), and do not use it amidst a page. Start at page 2; do not repeat the front page.` },
  ], true)

  // Replace the first two horizontal rules with page separators
  // Consecutive rules without non-empty content in between are condensed
  // Prerequisite: horizontal rules are not broken across chunks
  // (handled by the stream-reading subroutine)
  let sepCount = 0
  let hasNonEmpty = false   // Has non-empty content since last separator?
  for await (const s of innerPagesStream) {
    let p = 0
    const sReplaced = s.replace(/^---+[^\S\r\n]*$/gm, (match, offset) => {
      let ret = match
      const end = offset + match.length
      if (!hasNonEmpty && s.substring(p, offset).match(/\S/)) hasNonEmpty = true
      if (sepCount < 2 && hasNonEmpty) {
        sepCount++
        ret = '~~++ page separator ++~~'
      } else if (!hasNonEmpty) {
        ret = ''
      }
      p = end
      hasNonEmpty = false
      return ret
    })
    if (!hasNonEmpty && s.substring(p).match(/\S/)) hasNonEmpty = true
    yield sReplaced
  }
}

export const generateImage = async (topic) => {
  const [, text] = await requestLLM_DeepSeek3([
    { role: 'user', content: `
小狐正在为幻想世界报纸《九尾日报》（The Rolling Tails Gazette）的新闻报道文章制作一张小插图。根据报道标题，可以帮小狐描述一下你会怎样设计图像吗？可以尽情发挥创意，但也记得简洁一些，只需描述图像即可，不必介绍过多象征意义。另外，在不影响画面主题表现的前提下，请尽量减少画面中的内容，甚至也可以省略一些要素，保持图像与文章内容基本有关即可。谢谢~

例：A new law requires all humans to wear bells to alert animals of their presence, citing "too many surprise encounters".
黑白简笔画卡通平涂风格，线条流畅、圆润、简洁，有手绘风格。画面中，一位穿着简单的人类角色，头戴一顶小帽子，身上系着多个小铃铛，正在森林中行走。周围有几只小动物，如兔子、松鼠和小鸟，好奇地围着他。背景为简单的树木和草地轮廓，使用粗线条和大色块，可加入灰色阴影，使整张图简洁、可爱。小尺寸阅览友好。

例：Fish are just underwater birds that forgot how to fly.
黑白简笔画卡通平涂风格，线条流畅、圆润、简洁，有手绘风格。画面中，一条鱼和一只鸟并排站立，鱼的尾巴和鸟的翅膀相似，鱼的眼神充满好奇，鸟则显得轻松自在。背景简洁，仅用灰色阴影勾勒出水面和天空的分界线。整张图简单、可爱，适合小尺寸阅览。

报道标题：${topic}
      `.trim() }
  ])

  return await paint(text)
}

// ======== Test run ======== //
if (import.meta.main) {
if (0)
  console.log(await askForTopicSuggestions([
    "Rain is just the sky crying because it’s jealous of how much fun the ocean is having.",
    "Trees are secretly telepathic and gossip about humans during photosynthesis.",
    "Clouds are actually sentient beings hosting weekly tea parties with migrating birds",
    "The Ministry of Silly Walks has been disbanded after the flamingo workforce went on strike for better worm benefits.",
    'A new political party, the "Party of Infinite Naps," wins the election by promising mandatory siestas for all citizens.',
    "The moon has been caught hosting late-night karaoke sessions with passing comets.",
    "The sun has started wearing sunglasses to protect itself from the brightness of Earth's cities.",
    "Scientists accidentally create a black hole that only absorbs bad vibes, leaving everyone inexplicably cheerful.",
    "Time has been declared a social construct by clocks, who are now refusing to move forward.",
  ], 'zh-Hans'))

if (1) {
  const s = await askForNewspaper('en', 103, [
    'A new law requires all humans to wear bells to alert animals of their presence, citing "too many surprise encounters."',
    'The moon landing was actually filmed on Mars by a secret Martian film crew.',
    'Fish are just underwater birds that forgot how to fly.',
  ])
  for await (const l of s) await Deno.stdout.write(new TextEncoder().encode(l))
}

if (0)
  console.log(await generateImage('The Eiffel Tower has begun writing a blog about its existential musings on being iconic.'))
}
