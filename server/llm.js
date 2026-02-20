import { logNetwork } from './db.js'
import { createEventSource } from 'npm:eventsource-client@1.1.3'
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
  Deno.env.get('API_KEY_ZHIPU') // || prompt('API key (Zhipu):')
)
const requestLLM_Spark = requestLLM_OpenAI(
  'https://spark-api-open.xf-yun.com/v1/chat/completions', 'generalv3.5', 1.6,
  Deno.env.get('API_KEY_SPARK') // || prompt('API key (Spark):')
)

const retry = (fn, attempts, errorMsgPrefix) => async (...args) => {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn(...args)
    } catch (e) {
      console.log(`${errorMsgPrefix}: ${e}`)
      if (i === attempts - 1) throw e
      continue
    }
  }
}

// Application-specific routines

const languageNames = {
  'en': ['English', 'English'],
  'zh-Hans': ['简体中文', 'Simplified Chinese'],
  'zh-Hant': ['繁/正體中文', 'Traditional Chinese'],
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

const getLangNameFull = (langCode) => {
  if (langCode.startsWith('+')) {
    return langCode.substring(1)
  } else {
    if (!languageNames[langCode]) return null
    return `${languageNames[langCode][1]} (${languageNames[langCode][0]})`
  }
}

// Returns: [[English text, native text]; 6]
const _askForTopicSuggestions = async (previousTopics, language) => {
  const langNameFull = getLangNameFull(language)
  if (!langNameFull) return null

  const [_, text] = await requestLLM_DeepSeek3([
    { role: 'user', content: `
In the 22nd century, foxes are the playful super-wizards. They traverse the world on a daily basis and report on discoveries, social activities, and political/economical events through Fox Newroll Network (FoxNN).

What can the topics of the next issue be? List 6 of your absolute favourites. Write each as a simple, concise, short sentence; omit the source ("scientists", "FoxNN", "document", etc.), simply describe the core topic. Let your imagination go wild, get as novel as possible ^ ^ Cover diverse topics including nature, animal society, science, art, animals' relationship with humans, etc. Do not get fox-centric; be nature-/animal-centric instead. Look at animals as well as non-life (natural objects; abstract concepts).

Make your ideas concise, in a playful tone, while being refreshingly innovative. Reply with the short, simple sentences in a Markdown list, without extra formatting (bold/italic).${language == 'en' ? '' : ` Reply in **${langNameFull}**. After all 6, translate them into English.`}

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
export const askForTopicSuggestions = retry(_askForTopicSuggestions, 3, 'Cannot retrieve topic suggestions')

export const askForNewspaper = async function* (language, issueNumber, topics) {
  const langNameFull = getLangNameFull(language)
  if (!langNameFull) return null

  const translate = (s) => s ? (' (' + s + ')') : ''
  let titleGazette = translate(
    language === 'zh-Hans' ? '九尾日报' :
    language === 'zh-Hant' ? '九尾日報' :
    'The Rolling Tail Gazette')
  let translationFoxNN = translate(
    language === 'zh-Hans' ? '狐研新闻社' :
    language === 'zh-Hant' ? '狐研新聞社' :
    '')
  let translationHeadsOrTails = translate(
    language === 'zh-Hans' ? '狐头狐尾魔法' :
    language === 'zh-Hant' ? '狐頭狐尾魔法' :
    '')
  const frontPagePrompt = `
In the 22nd century, foxes are the playful super-wizards. They traverse the world on a daily basis, observing, and discovering through a mechanism known as 'heads or tails'${translationHeadsOrTails} (no, it's not coin flipping, just some fox magic outside of the reach of languages). Fox Newroll Network (FoxNN)${translationFoxNN} is a news agent that regularly publishes reports obtained this way.

Please help the foxes finish the issue! Remember that this is a whimsical world, so don't treat them as breaking news, everything is just regular ^ ^ Please make a front page making an introduction to today's issue and then overviewing/outlining the contents (with pointers to the pages). Start with the header given below. Do not add another overall title (e.g. "Front Page: xxx" or "Today's Headlines: xxx"), but subtitles are allowed.

Header:
# **${titleGazette} 🦊**
== *22nd Century Edition* | *Issue ${issueNumber}* | *Fox Newroll Network* ==${
  language === 'en' ? '' : (
    `\n\nAfter this header, continue in **${langNameFull}**.`
    + (
      language !== 'en' && !translationFoxNN ?
        ' Please do not translate the title and FoxNN; use the original English names.' :
        ''
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
      const m = headerCombined.match(/==\s*\n(?:^---[-\s]*)*(^[^-\n][\S\s]*\S[\S\s]*|^[^-\n\s])/m)
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

const _generateImage = async (topic) => {
  const [, text] = await requestLLM_DeepSeek3([
    { role: 'user', content: `
幻想世界报纸《九尾日报》准备发布新的新闻报道文章，请你根据报道主题制作一张小插图。可适当发挥创意，但请简洁一些，保留主题中的核心元素或人物，清晰明确地描述图像的内容，避免比喻。用英语撰写。谢谢~

Ex: A new law requires all humans to wear bells to alert animals of their presence, citing "too many surprise encounters".
A hand-drawn black and white ink illustration of a cheerful girl walking through a whimsical forest, wearing a hat with bunny ears and a dress decorated with a string of hanging bells, surrounded by cute animals like squirrels, rabbits, and birds. Cartoon style, childlike charm, storybook aesthetic, line art, playful and nostalgic mood, ink wash.

Ex: Fish are just underwater birds that forgot how to fly.
A hand-drawn black and white ink illustration. A bird stands on the edge of a shallow, clear tide pool, looking down. Inside the pool, a fish tilts its head up, meeting the bird's gaze with a look of deep contemplation and confusion. The fish's tail fin is prominently shaped almost exactly like the bird's unfolded wing. The only background is the faint gray wash of the sky meeting the calm water's surface at the horizon. Cartoon style, childlike charm, storybook aesthetic, line art, playful and nostalgic mood, ink wash.

Title: ${topic}
      `.trim() }
  ])

  return await paint(text)
}
export const generateImage = retry(_generateImage, 3, 'Cannot paint image')

// ======== Test run ======== //
if (import.meta.main) {
if (1)
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

if (0) {
  const s = await askForNewspaper('zh-Hans', 103, [
    'A new law requires all humans to wear bells to alert animals of their presence, citing "too many surprise encounters."',
    'The moon landing was actually filmed on Mars by a secret Martian film crew.',
    'Fish are just underwater birds that forgot how to fly.',
  ])
  for await (const l of s) await Deno.stdout.write(new TextEncoder().encode(l))
}

if (0)
  console.log(await generateImage('The Eiffel Tower has begun writing a blog about its existential musings on being iconic.'))
}
