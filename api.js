module.exports = function getApi(_, io, options, querystring, Promise, request, url, util) {
    var defaultBaseUrl = _.trimEnd(options.api || 'http://localhost/api', '/');
    request = request.defaults({
        baseUrl: defaultBaseUrl,
        method: 'GET',
        headers: {
            'X-API-Key': options.apikey,
        },
        json: true,
        useQuerystring: true,
    });

    var loginResponse = undefined;

    return {
        _http: function(opts) {
            opts.path = opts.path ? opts.path.replace(/^\/api/, '') : undefined;
            return httpFn(opts.method || 'GET', opts.path)(opts);
        },
        login: function() {
            return http('/oauth2/token', {
                baseUrl: url.resolve(defaultBaseUrl, '/'),
                method: 'POST',
                form: {
                    grant_type: 'password',
                    scope: 'openid',
                    username: options.user || process.env.USER,
                    password: options.password || process.env.PASSWORD,
                },
            }).then(x => loginResponse = x);
        },
        orgUnits: _.extend(function orgUnits(id) {
            return {
                get: httpFn('GET', 'org-units/%s', id),
                put: httpFn('PUT', 'org-units/%s', id),
            };
        }, {
            get: httpFn('GET', 'org-units'),
            post: httpFn('POST', 'org-units'),
        }),
        users: _.extend(function users(id) {
            return {
                get: httpFn('GET', 'users/%s', id),
                put: httpFn('PUT', 'users/%s', id),
                contactInfo: {
                    get: httpFn('GET', 'users/%s/contact-info', id),
                    put: httpFn('PUT', 'users/%s/contact-info', id),
                },
                orgUnits: {
                    get: httpFn('GET', 'users/%s/org-units', id),
                    put: httpFn('PUT', 'users/%s/org-units', id),
                },
                settings: _.extend(function settings(key) {
                    return {
                        get: httpFn('GET', 'users/%s/settings/%s', id, key),
                        put: httpFn('PUT', 'users/%s/settings/%s', id, key),
                    };
                }, {
                    get: httpFn('GET', 'users/%s/settings', id),
                }),
            };
        }, {
            get: httpFn('GET', 'users'),
            post: httpFn('POST', 'users'),
            search: httpFn('GET', 'users/search'),
        }),
    };

    function httpFn(method, path) {
        var path = util.format.apply(util.format, _.slice(arguments, 1));
        method = method.toUpperCase(),
        argQuery = _.includes(['GET', 'DELETE'], method);

        return function(opts) {
            var opts = _.some(['query', 'headers', 'contentType', 'body'], _.propertyOf(opts)) ? opts : {
                query: argQuery || arguments.length > 1 ? _.first(arguments) : undefined,
                body: _(arguments).drop(argQuery || arguments.length > 1 ? 1 : 0).first(),
            }
            return http(path, _(opts)
                .defaults({
                    method: method,
                    qs: opts.query,
                })
                .omit('query')
                .value());
        };
    }

    function http(path, opts) {
        path = '/' + _.trimStart(path, '/');
        return new Promise(function(resolve, reject) {
            opts = _.extend(opts || {}, {
                url: path,
                headers: {
                    Authorization: loginResponse
                        ? util.format('Bearer %s', loginResponse.access_token)
                        : undefined,
                },
            });
            request(opts, function(error, response, body) {
                if (error) {
                    return reject(error);
                }

                var result = {
                    status: {
                        code: response.statusCode || _.get(body, 'api:status.code'),
                        message: response.statusMessage || _.get(body, 'api:status.message'),
                    },
                    headers: response.headers,
                    body: body,
                };

                if (result.status.code >= 400) {
                    return reject(_.set(result.body || {}, 'status.message', [
                        opts.method || 'GET',
                        path,
                        '-',
                        result.status.message,
                    ].join(' ')));
                }

                return resolve(opts.returnDetail ? result : body);
            });
        });
    }
};
