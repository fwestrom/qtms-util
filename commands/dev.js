/*
 *  options.projectdir
 */
module.exports = function(_, child_process, fs, inject, io, logging, options, os, path, Promise) {
    var log = logging.getLogger('dev');
    fs = Promise.promisifyAll(fs);

    var projectdir = process.cwd();
    _.defaults(options, {
        projectdir: projectdir,
        builddir: path.join(projectdir, '.build'),
        servicesdir: path.join(projectdir, 'services'),
        supportuidir: path.join(projectdir, 'support/ui'),
        qsappuidir: options.qsappuidir || _.get(options, 'qs-app-ui.dir') || options['qs-app-ui-dir'] || (options.dev ? path.join(projectdir, '../qs-app-ui') : null),
        composefile: 'docker-compose.yml',
        registry: 'docker.qtort.com',
        output: options.o || options.out || options.output,
        project: options.p || options.project || 'qs',
        verbose: options.v || options.verbose,
    });
    _.defaults(options, {
        o: options.output,
        out: options.output,
        p: options.project,
        v: options.verbose,
    });

    return inject(require('./lib/spawner.js')).then(function(spawner) {
        inject = inject.child({
            getServices: getServices,
            spawner: spawner,
        });

        var cmds = _(/^function\s(?:\w+)?\(([^\)]*)\)/g.exec(dev.toString())).drop(1).first().split(', ');
        return Promise.resolve(cmds)
            .map(function(cmd) { return './lib/dev-' + cmd; })
            .map(require)
            .map(inject)
            .spread(dev);

        // function dev(build, clean, compose, deploy, pack, broker, firehose, test) {
        function dev(build, clean, compose, firehose) {


            return _.extend(function() {
                io.out('Please specify a dev command.');
            }, {
                build: build,
                clean: clean,
                compose: compose,
                // deploy: deploy,
                // pack: pack,
                // broker: broker,
                firehose: firehose,
                // 'integration-test' : test,
                // 'npm-update-qtort': npmUpdateQtort,
            });
        }

        function getServices() {
            var log = logging.getLogger('getServices')
            log.debug('projectdir:', options.projectdir);
            log.debug('servicesdir:', options.servicesdir);
            log.debug('supportuidir:', options.supportuidir);
            log.debug('qsappuidir:', options.qsappuidir);

            return Promise
                .try(() => {
                    if ((options.dev || options.mode == 'dev') && !fs.existsSync(options.qsappuidir)) {
                        log.warn('Unable to find qs-app-ui directory for live volume mount; please specify with --qs-app-ui.dir=PATH to enable the live volume.');
                        return Promise.delay(10000);
                    }
                })
                .then(() => fs.readdirAsync(options.servicesdir))
                .map(_.partial(_.ary(path.join, 2), options.servicesdir, _))
                .filter(function(file) {
                    return fs.statSync(file).isDirectory();
                })
                .map(_.ary(getServiceObj, 1))
                .filter(function(service) {
                    if(options.block !== service.name) {
                        return _.includes(service.files, 'Dockerfile');
                    }
                })
                .map(function(service) {
                    if(options.block !== service.name) {
                        return _.omit(service, ['files']);
                    }
                })
                .then(function(services) {
                    if (options.qsappuidir) {
                        // services.push(getServiceObj(options.qsappuidir, 'qs-app-ui'));
                    }
                    return services.concat([
                        // getServiceObj(path.join(options.projectdir, 'ext', 'wso2is'), 'wso2is'),
                        getServiceObj(path.join(options.projectdir, 'ext', 'nginx'), 'nginx'),
                    ]);
                });

            function getServiceObj(dir, name) {
                var service = {
                    dir: dir,
                    name: name || path.basename(dir),
                    files: fs.existsSync(dir) ? fs.readdirSync(dir) : undefined,
                };
                if (_.includes(service.files, 'package.json')) {
                    _.extend(service, {
                        npm: _.partial(npm, service),
                        package: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))),
                    });
                }
                return service;
            }

            function npm(service, command, args) {
                var log = logging.getLogger('npm');
                log[options.verbose ? 'info' : 'debug']('npm %s - %s', command, service.name);
                return spawner.spawn(service.dir, 'npm', _.concat([
                    command,
                    options.verbose ? '-q' : '-s',
                    '--progress', 'false',
                ], args || []));
            }
        }

        function npmUpdateQtort(packageId) {
            var log = logging.getLogger('npm-update-qtort');
            var equivalents = [
                'qtort-microservices',
                'microservice-crutch',
                'medseek-util-microservices',
            ];
            return getServices()
            .filter(function(service) {
                return !_.some(equivalents, function(pn) {
                    return _.get(service, 'package.dependencies' + pn);
                });
            })
            .map(function(service) {
                log.info('updating service:', service.name);
                return Promise
                .try(function() {
                    return service.npm('uninstall', ['--save'].concat(equivalents));
                })
                .tap(function() {
                    return service.npm('install', [
                        '--save',
                        packageId || 'qtort-microservices',
                    ]);
                });
            });
        }
    });
};
