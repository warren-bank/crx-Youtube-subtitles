// ==UserScript==
// @name         Youtube subtitles
// @description  Provide the ability to download subtitles for the current video.
// @version      1.0.0
// @match        *://*.youtube.com/watch?v=*
// @match        *://*.youtube.com/embed/*
// @icon         https://www.youtube.com/favicon.ico
// @run-at       document-end
// @grant        unsafeWindow
// @homepage     https://github.com/warren-bank/crx-Youtube-subtitles/tree/webmonkey-userscript/es5
// @supportURL   https://github.com/warren-bank/crx-Youtube-subtitles/issues
// @downloadURL  https://github.com/warren-bank/crx-Youtube-subtitles/raw/webmonkey-userscript/es5/webmonkey-userscript/Youtube-subtitles.user.js
// @updateURL    https://github.com/warren-bank/crx-Youtube-subtitles/raw/webmonkey-userscript/es5/webmonkey-userscript/Youtube-subtitles.user.js
// @namespace    warren-bank
// @author       Warren Bank
// @copyright    Warren Bank
// ==/UserScript==

// ----------------------------------------------------------------------------- user options

var user_options = {
  "save_result_calls_GM_download": (typeof window.WebViewWM === 'object')
}

// ----------------------------------------------------------------------------- constants

var constants = {
  query_selector: {
    userscripts_row_container_parent: "div#above-the-fold",
    userscripts_row_container_prev_sibling: "div#top-row"
  },
  element_id: {
    userscripts_row_container: "userscripts-row",
    subtitles_container: "subtitles_container",
    select_caption_track: "select_caption_track",
    select_translation_language: "select_translation_language",
    button_download_subtitles: "button_download_subtitles"
  },
  button_text: {
    show_subtitles_options: "Download Subtitles",
    download_subtitles: "Download",
    save_subtitles: "Save",
    close_button: "X"
  },
  notification_text: {
    select_caption_track_label: "Caption Track:",
    select_translation_language_label: "Translate to Language:"
  },
  inline_css: {
    userscripts_row_container: "position: relative; top: 0; left: 0; overflow: visible;",
    subtitles_container: "display: block; position: absolute; top: 0px; left: 0px; z-index: 9999; background-color: white; padding: 2em; border: 1px solid #000; text-align: center;",
    close_button: "display: block; position: absolute; top: -1em; right: -1em; z-index: 9999; width: 2em; height: 2em; padding: 0.5em; line-height: 1em; cursor: pointer;",
    text_button: "background-color: #065fd4; color: #fff; padding: 10px 15px; border-radius: 18px; border-style: none; outline: none; font-weight: bold; cursor: pointer;",
    table_subtitles_options:  "text-align: left;"
  }
}

// ----------------------------------------------------------------------------- state

var state = {
  captionJSON: null
}

// ----------------------------------------------------------------------------- CSP

/*
 * add support for CSP 'Trusted Type' assignment
 */
var add_default_trusted_type_policy = function() {
  if (typeof unsafeWindow.trustedTypes !== 'undefined') {
    try {
      var passthrough_policy = function(string) {return string}

      unsafeWindow.trustedTypes.createPolicy('default', {
          createHTML:      passthrough_policy,
          createScript:    passthrough_policy,
          createScriptURL: passthrough_policy
      })
    }
    catch(e) {}
  }
}

// ----------------------------------------------------------------------------- helpers

var make_element = function(elementName, html) {
  var el = unsafeWindow.document.createElement(elementName)

  if (html)
    el.innerHTML = html

  return el
}

var empty_element = function(el, html) {
  while (el.childNodes.length)
    el.removeChild(el.childNodes[0])

  if (html)
    el.innerHTML = html

  return el
}

var cancel_event = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=false;
}

// ----------------------------------------------------------------------------- helpers (xhr)

var serialize_xhr_body_object = function(data) {
  if (typeof data === 'string')
    return data

  if (!(data instanceof Object))
    return null

  var body = []
  var keys = Object.keys(data)
  var key, val
  for (var i=0; i < keys.length; i++) {
    key = keys[i]
    val = data[key]
    val = unsafeWindow.encodeURIComponent(val)

    body.push(key + '=' + val)
  }
  body = body.join('&')
  return body
}

var download_text = function(url, headers, data, callback) {
  if (data) {
    if (!headers)
      headers = {}
    if (!headers['content-type'])
      headers['content-type'] = 'application/x-www-form-urlencoded'

    switch(headers['content-type'].toLowerCase()) {
      case 'application/json':
        data = JSON.stringify(data)
        break

      case 'application/x-www-form-urlencoded':
      default:
        data = serialize_xhr_body_object(data)
        break
    }
  }

  var xhr    = new unsafeWindow.XMLHttpRequest()
  var method = data ? 'POST' : 'GET'

  xhr.open(method, url, true, null, null)

  if (headers && (typeof headers === 'object')) {
    var keys = Object.keys(headers)
    var key, val
    for (var i=0; i < keys.length; i++) {
      key = keys[i]
      val = headers[key]
      xhr.setRequestHeader(key, val)
    }
  }

  xhr.onload = function(e) {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        callback(xhr.responseText)
      }
    }
  }

  if (data)
    xhr.send(data)
  else
    xhr.send()
}

var download_json = function(url, headers, data, callback) {
  if (!headers)
    headers = {}
  if (!headers.accept)
    headers.accept = 'application/json'

  download_text(url, headers, data, function(text){
    try {
      callback(JSON.parse(text))
    }
    catch(e) {}
  })
}

// ----------------------------------------------------------------------------- utils

var download_caption_track = function(caption_track_index, translation_language_index, callback) {
  caption_track_index = parseInt(caption_track_index, 10)
  translation_language_index = parseInt(translation_language_index, 10)

  if (!state.captionJSON || isNaN(caption_track_index) || (caption_track_index < 0)) return

  var url = state.captionJSON.captionTracks[caption_track_index].baseUrl

  if (!isNaN(translation_language_index) && (translation_language_index >= 0)) {
    url += '&tlang=' + state.captionJSON.translationLanguages[translation_language_index].languageCode
  }

  download_text(url, null, null, callback)
}

/*
 * decode HTML entities
 *
 * Text string is assumed to be safe,
 * and not contain any <script> tags.
 */
var decodeEntities = (function() {
  var element = make_element('div')
  return function(txt) {
    if (typeof txt !== 'string') {
      txt = ''
    }
    if (txt) {
      element.innerHTML = txt
      txt = element.textContent
      element.innerHTML = ''
    }
    return txt
  }
})()

var striptags = function(txt) {
  return txt.replace(/<\/?[^>]+(?:>|$)/g, '')
}

/*
 * Convert the time in seconds to SRT valid format
 *
 * The timecode format used is hours:minutes:seconds,milliseconds with time units
 * fixed to two zero-padded digits and fractions fixed to three zero-padded digits (00:00:00,000)
 *
 * https://en.wikipedia.org/wiki/SubRip
 */
var secToTime = function(secs) {
  var pad = function(n, z) {
    if (typeof z !== 'number') z = 2
    return ('00' + n).slice(-z)
  }
  var time = parseFloat(secs)
  var hours = Math.floor(time / 3600)
  var minutes = Math.floor(time / 60) % 60
  var seconds = Math.floor(time % 60)
  var milliseconds = Math.round((time % 1) * 1000)
  return [hours, minutes, seconds]
    .map(function(v) {return pad(v)})
    .join(':')
    .concat(',', pad(milliseconds, 3))
}

/*
 * Base64 encode / decode: UTF-8 strings
 *
 * https://stackoverflow.com/a/26603875
 * http://www.webtoolkit.info
 */
var Base64 = {

    // private property
    _keyStr: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/="

    // public method for encoding
    , encode: function (input)
    {
        var output = "";
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4;
        var i = 0;

        input = Base64._utf8_encode(input);

        while (i < input.length)
        {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);

            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;

            if (isNaN(chr2))
            {
                enc3 = enc4 = 64;
            }
            else if (isNaN(chr3))
            {
                enc4 = 64;
            }

            output = output +
                this._keyStr.charAt(enc1) + this._keyStr.charAt(enc2) +
                this._keyStr.charAt(enc3) + this._keyStr.charAt(enc4);
        } // End while

        return output;
    } // End Function encode 


    // public method for decoding
    ,decode: function (input)
    {
        var output = "";
        var chr1, chr2, chr3;
        var enc1, enc2, enc3, enc4;
        var i = 0;

        input = input.replace(/[^A-Za-z0-9\+\/\=]/g, "");
        while (i < input.length)
        {
            enc1 = this._keyStr.indexOf(input.charAt(i++));
            enc2 = this._keyStr.indexOf(input.charAt(i++));
            enc3 = this._keyStr.indexOf(input.charAt(i++));
            enc4 = this._keyStr.indexOf(input.charAt(i++));

            chr1 = (enc1 << 2) | (enc2 >> 4);
            chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
            chr3 = ((enc3 & 3) << 6) | enc4;

            output = output + String.fromCharCode(chr1);

            if (enc3 != 64)
            {
                output = output + String.fromCharCode(chr2);
            }

            if (enc4 != 64)
            {
                output = output + String.fromCharCode(chr3);
            }

        } // End while

        output = Base64._utf8_decode(output);

        return output;
    } // End Function decode 


    // private method for UTF-8 encoding
    ,_utf8_encode: function (string)
    {
        var utftext = "";
        string = string.replace(/\r\n/g, "\n");

        for (var n = 0; n < string.length; n++)
        {
            var c = string.charCodeAt(n);

            if (c < 128)
            {
                utftext += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048))
            {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            }
            else
            {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }

        } // Next n 

        return utftext;
    } // End Function _utf8_encode 

    // private method for UTF-8 decoding
    ,_utf8_decode: function (utftext)
    {
        var string = "";
        var i = 0;
        var c, c1, c2, c3;
        c = c1 = c2 = 0;

        while (i < utftext.length)
        {
            c = utftext.charCodeAt(i);

            if (c < 128)
            {
                string += String.fromCharCode(c);
                i++;
            }
            else if ((c > 191) && (c < 224))
            {
                c2 = utftext.charCodeAt(i + 1);
                string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
                i += 2;
            }
            else
            {
                c2 = utftext.charCodeAt(i + 1);
                c3 = utftext.charCodeAt(i + 2);
                string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
                i += 3;
            }

        } // End while

        return string;
    } // End Function _utf8_decode 

}

// ----------------------------------------------------------------------------- DOM: container element for userscripts UI

var add_userscripts_row_container = function(callback) {
  var prev_sibling = unsafeWindow.document.querySelector(
    constants.query_selector.userscripts_row_container_parent + ' > ' + constants.query_selector.userscripts_row_container_prev_sibling
  )
  if (!prev_sibling) {
    setTimeout(
      function() {
        add_userscripts_row_container(callback)
      },
      1000
    )
    return
  }
  // DOM is ready

  var userscripts_row_container = get_userscripts_row_container()
  if (userscripts_row_container) {
    // container has already been added to DOM (by another userscript with common UI)
    callback()
    return
  }

  userscripts_row_container = make_element('div')
  userscripts_row_container.setAttribute('id',    constants.element_id.userscripts_row_container)
  userscripts_row_container.setAttribute('style', constants.inline_css.userscripts_row_container)

  if (prev_sibling.nextSibling) {
    prev_sibling.parentNode.insertBefore(userscripts_row_container, prev_sibling.nextSibling)
  }
  else {
    prev_sibling.parentNode.appendChild(userscripts_row_container)
  }
  callback()
}

var get_userscripts_row_container = function() {
  return unsafeWindow.document.querySelector(constants.query_selector.userscripts_row_container_parent + ' > div#' + constants.element_id.userscripts_row_container)
}

// ----------------------------------------------------------------------------- DOM: container element for subtitles

var add_subtitles_container = function() {
  var userscripts_row_container = get_userscripts_row_container()
  var max_width = userscripts_row_container.parentElement.clientWidth
  var min_width = Math.floor(max_width / 4)

  var subtitles_container = make_element('div', [
    '<button style="' + constants.inline_css.close_button + '">',
    '  <span>' + constants.button_text.close_button + '</span>',
    '</button>',
    '<div></div>'
  ].join("\n"))
  subtitles_container.setAttribute('id',    constants.element_id.subtitles_container)
  subtitles_container.setAttribute('style', constants.inline_css.subtitles_container + ' max-width: ' + max_width + 'px; min-width: ' + min_width + 'px;')
  subtitles_container.querySelector('button').addEventListener('click', hide_subtitles_container.bind(null, subtitles_container))

  if (userscripts_row_container.childNodes.length) {
    userscripts_row_container.insertBefore(subtitles_container, userscripts_row_container.childNodes[0])
  }
  else {
    userscripts_row_container.appendChild(subtitles_container)
  }

  return subtitles_container
}

var get_subtitles_container = function() {
  return document.getElementById(constants.element_id.subtitles_container) || add_subtitles_container()
}

var hide_subtitles_container = function(subtitles_container) {
  if (!subtitles_container)
    subtitles_container = get_subtitles_container()

  subtitles_container.style.display = 'none'
}

var show_subtitles_container = function(subtitles_container) {
  if (!subtitles_container)
    subtitles_container = get_subtitles_container()

  subtitles_container.style.display = 'block'
}

var update_subtitles_container = function(subtitles_container, html) {
  if (!subtitles_container)
    subtitles_container = get_subtitles_container()

  var inner_div = subtitles_container.querySelector(':scope > div')
  if (inner_div)
    empty_element(inner_div, html)
}

// ----------------------------------------------------------------------------- DOM: button to display subtitles options

var add_show_subtitles_options_button = function() {
  var userscripts_row_container = get_userscripts_row_container()

  var show_subtitles_options_button = make_element('button', '<span>' + constants.button_text.show_subtitles_options + '</span>')
  show_subtitles_options_button.setAttribute('style', constants.inline_css.text_button)
  show_subtitles_options_button.addEventListener('click', show_subtitles_options)

  userscripts_row_container.appendChild(show_subtitles_options_button)
}

// ----------------------------------------------------------------------------- DOM: subtitles options

var show_subtitles_options = function(event) {
  cancel_event(event)

  var subtitles_container = get_subtitles_container()
  hide_subtitles_container(subtitles_container)

  /*
   * ES6:
   * -------------------------------------------------------
   *   update_subtitles_container(subtitles_container, `
   *     <table style="${constants.inline_css.table_subtitles_options}">
   *       <tr valign="middle">
   *         <td>${constants.notification_text.select_caption_track_label}</td>
   *         <td><select id="${constants.element_id.select_caption_track}"></select></td>
   *       </tr>
   *       <tr valign="middle">
   *         <td>${constants.notification_text.select_translation_language_label}</td>
   *         <td><select id="${constants.element_id.select_translation_language}"></select></td>
   *       </tr>
   *       <tr valign="middle">
   *         <td colspan="2" align="center">
   *           <button id="${constants.element_id.button_download_subtitles}" style="${constants.inline_css.text_button}">
   *             <span>${constants.button_text.download_subtitles}</span>
   *           </button>
   *         </td>
   *       </tr>
   *     </table>
   *   `)
   * -------------------------------------------------------
   */

  /*
   * ES5:
   */
  update_subtitles_container(subtitles_container, [
    '<table style="' + constants.inline_css.table_subtitles_options + '">',
    '  <tr valign="middle">',
    '    <td>' + constants.notification_text.select_caption_track_label + '</td>',
    '    <td><select id="' + constants.element_id.select_caption_track + '"></select></td>',
    '  </tr>',
    '  <tr valign="middle">',
    '    <td>' + constants.notification_text.select_translation_language_label + '</td>',
    '    <td><select id="' + constants.element_id.select_translation_language + '"></select></td>',
    '  </tr>',
    '  <tr valign="middle">',
    '    <td colspan="2" align="center">',
    '      <button id="' + constants.element_id.button_download_subtitles + '" style="' + constants.inline_css.text_button + '">',
    '        <span>' + constants.button_text.download_subtitles + '</span>',
    '      </button>',
    '    </td>',
    '  </tr>',
    '</table>'
  ].join("\n"))

  var html

  // populate caption tracks
  html = state.captionJSON.captionTracks
    .filter(function(track) {
      return track && track.baseUrl && track.name && track.name.simpleText
    })
    .sort(function(a, b) {
      return a.name.simpleText - b.name.simpleText
    })
    .map(function(track, index) {
      return '<option value="' + index + '">' + track.name.simpleText + '</option>'
    })
  subtitles_container.querySelector('#' + constants.element_id.select_caption_track).innerHTML = html.join("\n")

  // populate translation languages
  html = state.captionJSON.translationLanguages
    .filter(function(lang) {
      return lang.languageCode && lang.languageName && lang.languageName.simpleText
    })
    .sort(function(a, b) {
      return a.languageName.simpleText - b.languageName.simpleText
    })
    .map(function(lang, index) {
      return '<option value="' + index + '">' + lang.languageName.simpleText + '</option>'
    })
  html.unshift('<option value="">[none]</option>')
  subtitles_container.querySelector('#' + constants.element_id.select_translation_language).innerHTML = html.join("\n")

  // attach event handler to button
  subtitles_container.querySelector('#' + constants.element_id.button_download_subtitles).addEventListener('click', download_subtitles)

  show_subtitles_container(subtitles_container)
}

// ----------------------------------------------------------------------------- DOM: button to save result

var show_save_subtitles_button = function(output_file_name, output_data_uri, subtitles_container) {
  if (!subtitles_container)
    subtitles_container = get_subtitles_container()

  /*
   * ES6:
   * -------------------------------------------------------
   *   update_subtitles_container(subtitles_container, `
   *     <a href="${output_data_uri}" download="${output_file_name}">
   *       <button style="${constants.inline_css.text_button}">
   *         <span>${constants.button_text.save_subtitles}</span>
   *       </button>
   *     </a>
   *   `)
   * -------------------------------------------------------
   */

  /*
   * ES5:
   */
  update_subtitles_container(subtitles_container, [
    '<a href="' + output_data_uri + '" download="' + output_file_name + '">',
    '  <button style="' + constants.inline_css.text_button + '">',
    '    <span>' + constants.button_text.save_subtitles + '</span>',
    '  </button>',
    '</a>'
  ].join("\n"))

  if (user_options.save_result_calls_GM_download) {
    subtitles_container.querySelector('a').addEventListener('click', function(event) {
      cancel_event(event)

      GM_download(output_data_uri, output_file_name)
    })
  }
}

// ----------------------------------------------------------------------------- based on: borrowed code
// https://github.com/eliascotto/youtube-subtitles-downloader/blob/master/src/index.js

/*
 * YTSubtitles._extractCaptions(html)
 */
var extractCaptionsFromJS = function(jsText) {
  var splittedHtml, videoDetails, jsonObj

  splittedHtml = jsText.split('"captions":')
  // jsText could contains captions or not
  if (splittedHtml.length > 1) {
    try {
      videoDetails = splittedHtml[1].split(',"videoDetails')[0]
      jsonObj = JSON.parse(videoDetails.replace('\n', ''))
      return jsonObj['playerCaptionsTracklistRenderer']
    }
    catch(e) {}
  }
  return null
}

/*
 * YTSub.fetch()
 */
var parseCaptionsXML = function(xmlText) {
  var regex = {
    start: /start="([\d.]+)"/,
    dur:   /dur="([\d.]+)"/,
    cleanup: [
      [
        /<text.+>/,
        ''
      ],
      [
        /&amp;/gi,
        '&'
      ],
      [
        /<\/?[^>]+(>|$)/g,
        ''
      ]
    ]
  }

  var lines = xmlText
    .replace('<?xml version="1.0" encoding="utf-8" ?><transcript>', '')
    .replace('</transcript>', '')
    .split('</text>')
    .map(function(line) {
      try {
        var match, start, duration, text

        match = regex.start.exec(line)
        if (!match) throw 0
        start = parseFloat(match[1])

        match = regex.dur.exec(line)
        if (match) {
          duration = parseFloat(match[1])
        }

        text = line
          .replace(regex.cleanup[0][0], regex.cleanup[0][1])
          .replace(regex.cleanup[1][0], regex.cleanup[1][1])
          .replace(regex.cleanup[2][0], regex.cleanup[2][1])

        text = decodeEntities(text)
        text = striptags(text)
        text = text.trim()
        if (!text) throw 0

        return { start, duration, text }
      }
      catch(e) {
        return null
      }
    })
    .filter(function(line) {
      return !!line
    })

  return lines
}

/*
 * YTSub.fetchSRT()
 *
 * Fetch the subtitles and convert the format to the SRT standard
 *
 * https://en.wikipedia.org/wiki/SubRip
 */
var convertXMLtoSRT = function(xmlText) {
  var lines = parseCaptionsXML(xmlText)
  var end1, end2, end

  return lines.map(function(line, index) {
    end1 = (line.duration)
      ? line.start + line.duration
      : Infinity

    end2 = (index + 1 < lines.length)
      ? lines[index + 1].start
      : Infinity

    end = Math.min(end1, end2)

    // fallback
    if (end === Infinity)
      end = line.start + 3

    return (index + 1) + "\r\n" + secToTime(line.start) + ' --> ' + secToTime(end) + "\r\n" + line.text + "\r\n\r\n"
  }).join('')
}

// ----------------------------------------------------------------------------- event handler: download selected subtitle

var download_subtitles = function(event) {
  cancel_event(event)

  var caption_track_index        = unsafeWindow.document.getElementById(constants.element_id.select_caption_track).value
  var translation_language_index = unsafeWindow.document.getElementById(constants.element_id.select_translation_language).value

  download_caption_track(caption_track_index, translation_language_index, function(xmlText) {
    var srtText, output_file_name, output_data_uri

    srtText = convertXMLtoSRT(xmlText)

    if (srtText) {
      output_file_name = 'subtitles.srt'
      output_data_uri  = 'data:application/x-subrip;charset=utf-8;base64,' + Base64.encode(srtText)

      show_save_subtitles_button(output_file_name, output_data_uri)
    }
  })
}

// ----------------------------------------------------------------------------- bootstrap

var page_init = function() {
  add_default_trusted_type_policy()

  add_userscripts_row_container(function() {
    extractCaptionsFromDOM()

    if (state.captionJSON) {
      add_show_subtitles_options_button()
    }
  })
}

var extractCaptionsFromDOM = function() {
  var scripts = unsafeWindow.document.querySelectorAll('script:not([src])')
  var needle  = 'var ytInitialPlayerResponse'
  var haystack

  for (var i=0; i < scripts.length; i++) {
    haystack = scripts[i].textContent.trim()
    if (haystack.indexOf(needle) === 0) {
      state.captionJSON = extractCaptionsFromJS(haystack)
      return
    }
  }
}

page_init()
