'use strict';

/*
 *  options.projectdir
 */

module.exports = function build(getServices, _, fs, inject, inspect, io, logging, options, os, path, Promise, spawner, util, uuid) {
    var yaml = require('js-yaml');
    let log = logging.getLogger('build');
    let logBuild = log;
    var hashes = '';

    let buildUuid = uuid.v1().split('-').join('');

    let concurrency = parseInt(options.concurrency);
    concurrency = options.concurrency = !Number.isNaN(concurrency) ? concurrency : 4;

    return function() {
        let skip = _.isArray(options.skip) ? options.skip : [options.skip];

        return init()
            .then(getServices)
            //.tap(() => fs.writeFileAsync(path.join(options.builddir, 'docker-images.hash'), ''))
            .tap(step('prepare', function(services, log) {
                log.info('prepare| .env');
                return prepareEnvironmentFile();
            }))
            .tap(step('prepare', function(services, log) {
                log.info('prepare| .build/docker-compose.yml');
                return prepareDockerComposeFile(services);
            }))
            .map(step('build-service', function(service, log) {
                return Promise.resolve(service)
                    .tap(step('npm', function(service, log) {
                        if (service.npm) {
                            log.info('npm install', service.name);
                            return Promise.resolve()
                                .tap(() => service.npm('install'))
                                .tap(() => service.npm('dedupe'))
                                .tap(() => service.npm('prune'));
                        }
                    }))
                    .tap(step('docker', function(service, log) {
                        log.info('docker build', service.name);
                        return Promise.resolve()
                            .tap(() => dockerBuild(service))
                            .tap(() => dockerTag(service))
                            .tap(() => dockerPush(service));
                    }))
            }), {
                concurrency: options.concurrency
            })
            .then(() => { return fs.writeFileAsync(path.join(options.builddir, 'docker-images.hash'), hashes) });


        function step(stepName, stepAction) {
            if (_.includes(skip, stepName)) {
                if (!step['skipped:' + stepName]) {
                    step['skipped:' + stepName] = true;
                    logBuild.warn('skipping build step:', stepName);
                }
                return _.noop();
            }

            let log = logging.getLogger('build.' + stepName);
            return function(x) {
                return stepAction(x, log);
            };
        }

        function init() {
            log.debug('init');
            return mkdir(options.builddir);
        }

        function prepareEnvironmentFile() {
            var envfile = path.join(options.projectdir, '.env');
            log.debug('prepareEnvironmentFile| .env file:', envfile);
            return fs.readFileAsync(envfile)
                .catch(function(error) {
                    log.warn('prepareEnvironmentFile| Creating local environment file: .env');
                    return '';
                })
                .then(function(envtext) {
                    log.trace('prepareEnvironmentFile| .env contents:', envtext);
                    var env = {}, match, expr = /^\s*([^=$]+)=\s*([^$]*?)\s*$/gm;
                    while ((match = expr.exec(envtext)) !== null) {
                        env[match[1]] = match[2];
                    }

                    var keys = _.keys(env);
                    _.defaults(env, {
                        DOCKER_OPTS: '--dns 10.50.21.70',
                        qs_broker: 'amqp://broker1',
                        qs_data: path.join('/', _.includes(os.platform, 'win') ? 'c' : 'opt', 'qs', 'data'),
                        qs_ep_exchange: 'topic://ep',
                        '#qs_ep_exchange': 'topic://api',
                        qs_http_port: 80,
                        qs_https_port: 443,
                        qs_loglevel: 'info',
                        qs_mongo: 'mongodb://mongo1/qs',
                        qs_ssh_port: 10022,
                        qs_elasticsearch: 'http://elasticsearch:9200',
                        qs_auth_identity_server : 'https://identity.qtort.com:9443',
                        qs_auth_domain : 'APP.QTORT.COM'
                    });

                    log.info('environment:\n%s', util.inspect(_.mapValues(env, v => _.isString(v) ? v.replace(/([a-z][a-z0-9-+\.]+):\/\/([^:\n]+):([^@\n]+)(?=@)/, '$1://$2:✀ ') : v), { depth: null, colors: true }));
                    var envpromise = Promise.resolve(env);
                    var added = _.difference(_.keys(env), keys);
                    if (added.length > 0) {
                        log.debug('prepareEnvironmentFile| added to .env:', added.join(', '));
                        envpromise = envpromise.tap(function(env) {
                            return fs.writeFileAsync(envfile, _.map(env, (v, k) => [k, v].join('=')).join('\n') + '\n');
                        });
                    }

                    return envpromise;
                });
        }

        function prepareDockerComposeFile(services) {
            return fs.readFileAsync(path.join(options.servicesdir, options.composefile))
                .then(yaml.safeLoad)
                .then(function(cf) {
                    var predefined = _.keys(cf.services);
                    _.forEach(cf.services, function(service, name) {
                        log.debug('found:', name);
                        if (service.build) {
                            service.build = path.relative(options.builddir, path.join(options.servicesdir, service.build));
                        }
                    });
                    _.forEach(services, function(service) {
                        var devmode = options.dev || options.mode === 'dev';
                        var servicedir = path.relative(options.builddir, service.dir);

                        var so = cf.services[service.name];
                        log.debug('%s:', so ? 'found' : 'adding', service.name);

                        if (options.block !== service.name) {
                            if (!so) {
                                so = cf.services[service.name] = {
                                    image: 'qs/' + service.name,
                                    entrypoint: (_.get(service, 'package.scripts.start')
                                         ? ['npm', 'start', '--']
                                         : ['node', '/opt/' + service.name]),
                                    command: [
                                        '--broker=${qs_broker}',
                                        '--ll=${qs_loglevel}',
                                    ],
                                    depends_on: [
                                        'broker1',
                                    ],
                                };
                            }

                            so = _.defaultsDeep(so, {
                                networks: {
                                    default: null,
                                },
                                deploy: {
                                    placement: {
                                        constraints: [],
                                    },
                                    resources: {
                                        limits: {
                                            // cpu: '0.2',
                                            memory: '256M',
                                        },
                                    },
                                },
                            });

                            if (!_.find(so.deploy.placement.constraints, c => _.startsWith(c, 'node.role'))) {
                                so.deploy.placement.constraints.push('node.role==worker');
                            }

                            // if (!so.networks || _.isEmpty(so.networks)) {
                            //     so.networks = ['default'];
                            // }

                            var qsservice = _.startsWith(so.image, 'qs/') || _.startsWith(so.image, options.registry + '/qs/');
                            if (qsservice) {
                                if (options.registry && !_.startsWith(so.image, options.registry + '/qs/')) {
                                    so.image = options.registry + '/' + so.image;
                                }

                                let roleKey = 'engine.labels.com.qtort.role';
                                if (!_.find(so.deploy.placement.constraints, c => _.startsWith(c, roleKey))) {
                                    so.deploy.placement.constraints.push(roleKey + '==worker');
                                }

                                if (devmode) {
                                    _.defaultsDeep(so, {
                                        restart: 'always',
                                    });
                                    so.volumes = [
                                        servicedir + ':/opt/' + service.name,
                                    ];
                                    if (_.has(service, 'package.scripts.watch')) {
                                        var args = so.entrypoint || [];
                                        switch (_.first(so.entrypoint)) {
                                            case 'node':
                                            args = _.drop(args, 2);
                                            break;
                                            case 'npm':
                                            args = _.drop(args, args[2] === 'run' ? 3 : 2);
                                            break;
                                        }
                                        so.entrypoint = ['npm', 'run', 'watch', '--'].concat(args);
                                    }
                                }
                            }
                        }
                    });

                    var outfile = path.join(options.builddir, options.composefile);
                    log.debug('prepareDockerComposeFile| writing to %s:\n', outfile, util.inspect(cf, { depth: null }));
                    return fs.writeFileAsync(outfile, yaml.safeDump(cf));
                });
        }

        function dockerBuild(service) {

            let args = _.compact([
                'build',
                '-q', //!options.verbose ? '-q' : null,
                '--pull',
                '-t', 'qs/' + service.name + ':latest',
                '-t', 'docker.qtort.com/qs/' + service.name + ':latest',
                '-t', 'docker.qtort.com/qs/' + service.name + ':build-' + buildUuid,
                '.',
            ])
            let spawn = require('child_process').spawn;
            let child = spawn('docker', args, { cwd: service.dir })
            let promise = new Promise(function(resolve, reject) {
                child.stdout.on('data', (data) => {
                    log.trace('dockerBuild| child.stdout.on data: ', data.toString('utf8'));
                    //fs.appendFile(path.join(options.builddir, 'docker-images.hash'), service.name + '=' + data.toString('utf8'), function(err) {
                    //    return reject(err);
                    //});
                    //hashes += service.name + '=' + data.toString('utf8')
                    //log.warn(hashes);
                    return resolve();
                })
                //return resolve();

                child.stderr.on('data', (data) => {
                    log.error('dockerBuild| child.stderr.on data: ', data.toString('utf8'))
                    return reject(data);
                })
            })
            return promise;
            //return spawner.spawn(service.dir, 'docker', _.compact([
            //    !options.verbose ? '-q' : null,
            //    '--pull',
            //    '-t', 'qs/' + options.project + '_' + service.name + ':latest',
            //    '-t', 'docker.qtort.com/qs/' + options.project + '_' + service.name + ':latest',
            //    options.builddir,
            //    'build',
            //]));
        }

        function dockerPush(service) {
            if (options.registry && options.push) {
                log.info('docker-push| pushing for service: %s', service.name);

                let args = _.compact([
                    'push',
                    'docker.qtort.com/qs/' + service.name + ':build-' + buildUuid,
                ])
                let execFile = require('child_process').execFile;
                let child = execFile('docker', args, {cwd: service.dir})
                let hashFile = path.join(options.builddir, 'docker-images.hash');

                var promise = new Promise(function(resolve, reject) {
                    child.stdout.on('data', data => {
                        let m = null;
                        let reg = /sha256:(\w[^\s]*)/gm;

                        if ((m = reg.exec(data)) !== null) {
                            let hash = m[0];
                            log.trace('dockerPush| child_process digest: ', hash);
                            //let re = new RegExp(service.name + '=.*', 'gm');
                            hashes += service.name + '=' + hash.toString('utf8') + '\n';
                            return resolve(hashes);
                            // return fs.readFileAsync(hashFile, 'utf8')
                            //     .then(content => {
                            //         let re = new RegExp(service.name + '=.*', 'gm');
                            //         return content.replace(re, service.name + '=' + hash);
                            //     })
                            //     .then(content => {return resolve(fs.writeFileAsync(hashFile, content))});
                        }
                    })
                    child.stderr.on('data', data => {
                        log.error('dockerPush| child.stderr.on data: ', data.toString('utf8'));
                        return reject(data);
                    })
                })
                return promise;
                // return spawner.spawn(service.dir, 'docker', [
                //     'push',
                //     //'docker.qtort.com/qs/' + service.name + ':latest',
                //     'docker.qtort.com/qs/' + service.name + ':build-' + buildUuid,
                // ])
                // .then(() => {
                //     // TODO: update docker-images.hash with new has for build-XXXX tagged digest
                // });
            }
            else if (options.push) {
                log.warn('docker-push| skipping push of service: %s', service.name);
            }
        }

        function dockerTag(service) {
            if (options.registry && options.push) {
                // return spawner.spawn(service.dir, 'docker', [
                //     'tag',
                //     'qs/' + service.name + ':latest',
                //     'docker.qtort.com/qs/' + service.name + ':latest',
                // ]);
            }
        }

        function mkdir(dir) {
            return fs.mkdirAsync(dir).catch(function(error) {
                if (error.code !== 'EEXIST') {
                    throw error;
                }
            }).return(dir);
        }
    };
};
