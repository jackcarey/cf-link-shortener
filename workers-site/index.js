import { getAssetFromKV, mapRequestToAsset } from '@cloudflare/kv-asset-handler'
import { Router } from 'itty-router'
import { json, text } from 'itty-router-extras'

//set true to bypass cloudflare caching
const DEBUG = true

async function handleEvent(event) {
    const router = Router()

    const serveAsset = async () => await AssetFromKV(event)

    const routeHTMLExt = async req => {
        let url = new URL(req.url)
        let urlStr = `${url.origin}${url.pathname}.html${url.search}`
        return Response.redirect(urlStr, 302)
    }

    const forceGET = async req => {
        if (req.method !== 'GET') {
            let url = new URL(req.url)
            return Response.redirect(url.toString(), 308)
        }
    }

    const errorResponse = (req, message) => {
        try {
            let url = new URL(req.url)
            return Response.redirect(
                `${url.origin}/error.html?msg=${encodeURIComponent(
                    message || 'Unknown Error'
                )}`,
                307
            )
        } catch (e) {
            return new Response(
                `${e.message || e.toString()} | ${message.toString() ||
                    'unknown error'}`,
                { status: 500 }
            )
        }
    }

    const successResponse = (req, message, id = null) => {
        try {
            let url = new URL(req.url)
            return Response.redirect(
                `${url.origin}/success.html?msg=${encodeURIComponent(
                    message || 'Success'
                )}${id ? '&id=' + encodeURIComponent(id) : ''}`,
                302
            )
        } catch (e) {
            return new Response(
                `${e.message || e.toString()} | ${message.toString() ||
                    'success'}`,
                { status: 500 }
            )
        }
    }

    const badAuthResponse = (req, message) => {
        // get the normal error response
        const err = errorResponse(req, message || 'No authorization')
        //make it mutable
        const response = new Response(err.body, { status: 401 })
        // Prompts the user for credentials.
        response.headers.set(
            'WWW-Authenticate',
            `Basic realm="Secure Area", charset="UTF-8"`
        )

        return response
    }

    const verifyBasicAuth = async request => {
        if (!request.headers.has('Authorization')) {
            return await badAuthResponse(request, 'No authorization')
        } else {
            const { user, pass } = basicAuthentication(request)
            if (user != USERNAME || pass != PASSWORD) {
                return await badAuthResponse(request, 'Bad authorization')
            }
        }
    }

    const findShortURL = async req => {
        let key = new URL(req.url).pathname.substring(1)
        let result = null
        await SHORTENED_LINKS.get(key)
            .then(url => (result = url))
            .catch() //let this fall through
        if (result) {
            return Response.redirect(result, 302)
        }
    }

    const KVKeyArray = async () => {
        let keys = []
        let list = await SHORTENED_LINKS.list()
        let cursor = ''
        //keep looping over keys until we have all of them
        do {
            if (list.keys.length > 0) {
                for (let i = 0; i < list.keys.length; ++i) {
                    let key = list.keys[i].name
                    keys.push(key)
                }
                if (!list.list_complete) {
                    cursor = list.cursor
                    list = await SHORTENED_LINKS.list({ cursor: cursor })
                }
            }
        } while (!list.list_complete && list.keys.length > 0)
        return keys
    }

    const addRoute = async req => {
        try {
            let formData = await req.formData()
            //if the URL is not valid then the ctor will throw an error that we can catch
            let longURL = new URL(formData.get('url'))

            let keys = await KVKeyArray()

            const getSegment = (fromStr, existingArray, len = 5) => {
                let index = 0
                len = Math.max(1, len)
                let value = fromStr.substring(index, index + len)
                while (
                    existingArray.indexOf(value) != -1 &&
                    index <= fromStr.length + 5
                ) {
                    ++index
                    value = fromStr.substring(index, index + len)
                }
                return value
            }

            //if the datetime string is not unique enough for some reason
            //then do the same again with a fetched random string

            let randomStr = await random()
            let newID = getSegment(randomStr, keys)

            return await SHORTENED_LINKS.put(newID, longURL.toString())
                .then(val => successResponse(req, `ID ${newID} added`, newID))
                .catch(err => errorResponse(req, `${newID} not added`))
        } catch (e) {
            let msg = `${e.message || e.toString()}`
            return errorResponse(req, msg)
        }
    }

    const removeRoute = async req => {
        try {
            let formData = await req.formData()
            let shortID = formData.get('id')
            if (shortID) {
                return await SHORTENED_LINKS.delete(shortID)
                    .then(value =>
                        successResponse(req, `ID ${shortID} deleted`)
                    )
                    .catch(errorResponse(req, `${shortID} not deleted`))
            } else {
                return errorResponse(req, `no id provided`)
            }
        } catch (e) {
            let msg = `${e.message || e.toString()}`
            return errorResponse(req, msg)
        }
    }

    const listShortURLs = async () => {
        let urlObj = {}
        let list = await SHORTENED_LINKS.list()
        let cursor = ''
        //keep looping over keys until we have all of them
        do {
            if (list.keys.length > 0) {
                for (let i = 0; i < list.keys.length; ++i) {
                    let key = list.keys[i].name
                    await SHORTENED_LINKS.get(key).then(val => {
                        if (val != null) {
                            urlObj[key] = val
                        }
                    })
                }
                if (!list.list_complete) {
                    cursor = list.cursor
                    list = await SHORTENED_LINKS.list({ cursor: cursor })
                }
            }
        } while (
            !list.list_complete &&
            list.keys.length > 0 &&
            Object.keys(urlObj).length < 1000
        )
        return json(urlObj)
    }

    //set up CRUDing
    router.post('/add.html', verifyBasicAuth, addRoute)
    router.post('/manage.html', verifyBasicAuth, removeRoute)
    router.get('/list', verifyBasicAuth, listShortURLs)

    //set up static routes
    router.all('/', serveAsset)
    router.get('/add', routeHTMLExt)
    router.get('/manage', routeHTMLExt)
    router.all('/error', routeHTMLExt)
    router.all('/success', routeHTMLExt)
    router.all('/404', routeHTMLExt)
    router.get('/add.html', verifyBasicAuth, serveAsset)
    router.get('/manage.html', verifyBasicAuth, serveAsset)
    router.all('/404.html', forceGET, serveAsset)
    router.all('/error.html', forceGET, serveAsset)
    router.all('/success.html', forceGET, serveAsset)
    router.all('/marko', () => text('polo'))

    //for all other routes, check the IDs against KV short URLs
    router.get('*', findShortURL, serveAsset)

    return await router.handle(event.request).catch(err => {
        let message =
            'unhandled routing error: ' + err.message || err.toString()
        if (!DEBUG) {
            try {
                return errorResponse(event.request, message)
            } catch (e) {
                return new Response(
                    `errorResponse failed '${e.message ||
                        e.toString()}' (message:'${message}')`
                )
            }
        } else {
            return new Response(message, { status: 500 })
        }
    })
}

async function AssetFromKV(event, options = {}) {
    /**
     * You can add custom logic to how we fetch your assets
     * by configuring the function `mapRequestToAsset`
     */
    // options.mapRequestToAsset = handlePrefix(/^\/docs/)
    options.mapRequestToAsset = handlePrefix(/^\/public/)

    try {
        if (DEBUG) {
            // customize caching
            options.cacheControl = {
                bypassCache: true,
            }
        }

        const page = await getAssetFromKV(event, options)

        // allow headers to be altered
        const response = new Response(page.body, page)

        response.headers.set('X-XSS-Protection', '1; mode=block')
        response.headers.set('X-Content-Type-Options', 'nosniff')
        response.headers.set('X-Frame-Options', 'DENY')
        response.headers.set('Referrer-Policy', 'unsafe-url')
        response.headers.set('Feature-Policy', 'none')

        return response
    } catch (e) {
        // if an error is thrown try to serve the asset at 404.html
        try {
            let notFoundResponse = await getAssetFromKV(event, {
                mapRequestToAsset: req =>
                    new Request(`${new URL(req.url).origin}/404.html`, req),
            })

            return new Response(notFoundResponse.body, {
                ...notFoundResponse,
                status: 404,
            })
        } catch (e) {
            return new Response('404.html not found!', { status: 404 })
        }
    }
}

/**
 * Here's one example of how to modify a request to
 * remove a specific prefix, in this case `/docs` from
 * the url. This can be useful if you are deploying to a
 * route on a zone, or if you only want your static content
 * to exist at a specific path.
 */
function handlePrefix(prefix) {
    return request => {
        // compute the default (e.g. / -> index.html)
        let defaultAssetKey = mapRequestToAsset(request)
        let url = new URL(defaultAssetKey.url)

        // strip the prefix from the path for lookup
        url.pathname = url.pathname.replace(prefix, '/')

        // inherit all other props from the default request
        return new Request(url.toString(), defaultAssetKey)
    }
}

addEventListener('fetch', event => {
    //handleEvent is necessary instead of router.handle() so that we can access the 'event' object for serving assets from KV
    event.respondWith(handleEvent(event))
})

/**
 * Parse HTTP Basic Authorization value.
 * @param {Request} request
 * @throws {BadRequestException}
 * @returns {{ user: string, pass: string }}
 */
function basicAuthentication(request) {
    const Authorization = request.headers.get('Authorization')

    const [scheme, encoded] = Authorization.split(' ')

    // The Authorization header must start with "Basic", followed by a space.
    if (!encoded || scheme !== 'Basic') {
        throw new BadRequestException('Malformed authorization header.')
    }

    // Decodes the base64 value and performs unicode normalization.
    // @see https://datatracker.ietf.org/doc/html/rfc7613#section-3.3.2 (and #section-4.2.2)
    // @see https://dev.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/String/normalize
    //depracted: const decoded = atob(encoded).normalize()
    const decoded = Buffer.from(encoded, 'base64')
        .toString()
        .normalize()

    // The username & password are split by the first colon.
    //=> example: "username:password"
    const index = decoded.indexOf(':')

    // The user & password are split by the first colon and MUST NOT contain control characters.
    // @see https://tools.ietf.org/html/rfc5234#appendix-B.1 (=> "CTL = %x00-1F / %x7F")
    if (index === -1 || /[\0-\x1F\x7F]/.test(decoded)) {
        throw new BadRequestException('Invalid authorization value.')
    }

    return {
        user: decoded.substring(0, index),
        pass: decoded.substring(index + 1),
    }
}

/**
 * Use this method to return a random number from cloudflare
 */
async function random() {
    //new rounds of randomness only occur every ~30 seconds, so we can cache this response
    let response = await fetch(
        new Request('https://drand.cloudflare.com/public/latest'),
        {
            cacheTtl: 30,
            cacheEverything: true,
        }
    )
    let { randomness } = await response.json()
    return randomness.toString()
}
