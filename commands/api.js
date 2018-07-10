module.exports = function(_, api, inject, io, logging, options, path, Promise) {
    var log = logging.getLogger('api');

    _.defaults(options, {
        url: 'http://localhost/api',
    });

    return _.assign({}, {
        get: apiGet
    });

    function apiGet() {
        return api.login()
            .then(result => io.out(result))
            .then(() => api.get())
            .then(result => io.out(result));
    }
};
