'use strict'
const allowIP = []
if (typeof ENV_ALLOW_IP !== "undefined") {
    Array.prototype.push.apply(allowIP, JSON.parse(ENV_ALLOW_IP))
}

/** @type {RequestInit} */
const PREFLIGHT_INIT = {
    status: 204,
    headers: new Headers({
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS',
        'access-control-max-age': '1728000',
    }),
}

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*'
    return new Response(body, { status, headers })
}


/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
    try {
        return new URL(urlStr)
    } catch (err) {
        return null
    }
}


addEventListener('fetch', e => {
    const ret = fetchHandler(e)
        .catch(err => makeRes('cfworker error:\n' + err.stack, 502))
    e.respondWith(ret)
})


function checkUrl(path) {
    return path.search(/^.+?\/.+?\/(?:info|git-).*$/i) == 0
}


/**
 * @param {FetchEvent} e
 */
async function fetchHandler(e) {
    const req = e.request
    let reqIP = req.headers.get('cf-connecting-ip')
    if (allowIP.length && !allowIP.includes(reqIP)) {
        return makeRes(`${reqIP} Access denied.`, 403)
    }
    const urlStr = req.url
    const urlObj = new URL(urlStr)
    let path = urlObj.href.substring(urlObj.origin.length + 1)
    if (checkUrl(path)) {
        return httpHandler(req, path)
    } else if (path.length) {
        return makeRes(`gh-proxy : Bad Request.`, 400)
    } else {
        return makeRes(`gh-proxy : Hi there.`)
    }
}


/**
 * @param {Request} req
 * @param {string} path
 */
function httpHandler(req, path) {
    const reqHeaderRaw = req.headers

    // preflight
    if (req.method === 'OPTIONS' &&
        reqHeaderRaw.has('access-control-request-headers')
    ) {
        return new Response(null, PREFLIGHT_INIT)
    }

    const reqHeaderNew = new Headers(reqHeaderRaw)

    const urlObj = newUrl('https://github.com/' + path)

    /** @type {RequestInit} */
    const reqInit = {
        method: req.method,
        headers: reqHeaderNew,
        redirect: 'manual',
        body: req.body
    }
    return proxy(urlObj, reqInit)
}


/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
    const res = await fetch(urlObj.href, reqInit)
    const resHeaderOld = res.headers
    const resHeaderNew = new Headers(resHeaderOld)

    const status = res.status

    if (resHeaderNew.has('location')) {
        let _location = resHeaderNew.get('location')
        if (checkUrl(_location))
            resHeaderNew.set('location', '/' + _location)
        else {
            reqInit.redirect = 'follow'
            return proxy(newUrl(_location), reqInit)
        }
    }
    resHeaderNew.set('access-control-expose-headers', '*')
    resHeaderNew.set('access-control-allow-origin', '*')

    resHeaderNew.delete('content-security-policy')
    resHeaderNew.delete('content-security-policy-report-only')
    resHeaderNew.delete('clear-site-data')

    return new Response(res.body, {
        status,
        headers: resHeaderNew,
    })
}

