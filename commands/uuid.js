module.exports = function factory(_, io, options, Promise, util, uuid) {
    return function uuid() {
        var use = options[62] || options['base62'] ? 'uuid-base62' : 'uuid';
        var value = require(use)['v' + (options.v || 1)]();
        if (use === 'uuid' && !options.nostrip) {
            value = value.split('-').join('');
        }

        io.out(value);
    };
};
