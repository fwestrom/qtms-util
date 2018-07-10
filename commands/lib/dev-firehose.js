module.exports = function build(_, app, cleanup, io, logging, inject, options, Promise, util) {
    return function() {
        var log = logging.getLogger('firehose');
        var trace = log.isTraceEnabled();

        return inject(function(microservices, serializer) {
            return Promise
                .all([
                    microservices.bind('topic://ep/#', recv),
                    microservices.bind('topic://api/#', recv),
                    microservices.bind('topic://services/#', recv),
                    microservices.bind(options.defaultExchange + '/#', recv),
                ])
                .return(new Promise((resolve, reject) => {
                    app.on('error', e => _.has(e, 'mc') ? recv(e.mc) : log.error('error|%s\n', e));
                    app.on('shutdown', resolve);
                    log.info('Ready.\n');
                }));

                function recv(mc) {
                    var body;
                    try {
                        var contentType = _.get(mc, 'properties.contentType') || 'text/plain';
                        body = serializer.deserialize(contentType, mc.body);
                    }
                    catch (error) {
                        body = mc.body;
                    }

                    if (_.isPlainObject(body) && _.isString(body.q) && _.isPlainObject(body.qp)) {
                        body.q = body.q.replace(/[\n\r\s]+/g, ' ');
                    }

                    var text = util.inspect(_(mc)
                        .omitBy(trace ? _.isUndefined : _.isNil)
                        .pickBy(trace ? _.stubTrue : _.rearg(_.partial(_.includes, [
                            'exchange',
                            'routingKey',
                            'properties',
                            'body'
                        ], _), [1]))
                        .assign({
                            body: body,
                        })
                        .value());

                    io.out('%s\n', log.isTraceEnabled() ? text : _.take(text.split(/\r?\n\r?/), 50).join('\n'));
                    _.unset(mc, 'properties.replyTo');
                }
        });
    };
};
