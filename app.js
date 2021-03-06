#!/usr/bin/env node
/*
   Copyright 2013 Callan Bryant <callan.bryant@gmail.com>

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

var config   = require('./config')
var restify  = require('restify')
var xml2js   = require('xml2js')
var fs       = require('fs')

// used just for dynamic theming
var static  = require('node-static')
var fileServer = new static.Server(__dirname+'/public/')

var aggregator = require('./aggregator').aggregator(config)
var importer   = aggregator.importer


var server = restify.createServer({
	name: 'megafilter',
	//certificate:'string',
	//key:'string',
	//version: '0.0.1'
})

server.use(restify.acceptParser(server.acceptable))
server.use(restify.queryParser())
server.use(restify.bodyParser({mapParams: false})) // req.body is then JSON content
server.use(restify.jsonp());
//server.use(restify.gzipResponse()); // breaks page load


// no auth for this, ever!
server.get('/published',function(req,res,next) {
	var count = req.query.count

	// limit
	if (!count || count > config.maxArticles || count <= 0)
		count = config.maxArticles

	var articles = aggregator.dump(count)

	res.send(articles.length?200:404,articles)
	return next()
})

server.use(restify.authorizationParser())
server.use(function (req,res,next) {
	// enabled?
	if (!config.password) return next()

	res.header('WWW-Authenticate','Basic realm="Megafilter"')

	if (!req.authorization.basic)
		// ask for auth, none was given so 401
		return next(new restify.InvalidCredentialsError())
	else if (
		req.authorization.basic.username == config.username
		&& req.authorization.basic.password == config.password
	)
		return next()
	else
		// 403
		return next(new restify.NotAuthorizedError())
})

server.get(/\/(next|current)/,function(req,res,next) {
	// first match will be 'next' or 'current'
	// which allows merging both methods into one handler
	// by calling aggregator.next() or aggregator.current()
	var article = aggregator[req.params[0]]()

	// do not cache this, Mr. Browser
	res.header('Expires',0)
	res.header('Cache-Control','no-cache, no-store, must-revalidate')
	res.header('Pragma','no-cache')

	res.send(article?200:404,article)
	return next()
})


server.put('/publish/:id',function(req,res,next) {
	var success = aggregator.publish(req.params.id)
	res.send(success?200:404,{success:success})
	return next()
})


server.del('/queue/:id',function(req,res,next) {
	var success = aggregator.discard(req.params.id)
	res.send(success?200:404,{success:success})
	return next()
})

server.del('/published/:id',function(req,res,next) {
	var success = aggregator.unpublish(req.params.id)
	res.send(success?200:404,{success:success})
	return next()
})

server.get('/pending',function(req,res,next) {
	res.send({
		pending:aggregator.pending()
	})
	return next()
})

server.post('/enqueue',function(req,res,next) {
	var success = aggregator.enqueue(req.body)
	res.send(success?200:500,{success:success})
	return next()
})

server.get('/style',function(req,res,next) {
	fileServer.serveFile('themes/'+config.theme+'.css', 200, {}, req, res)
})

// any other request, for static things
server.get(/.*/,restify.serveStatic({
	directory:__dirname+'/public/',
	default:'index.html',
	//maxAge:3600,
	maxAge:0, // disable cache
}))


server.listen(config.port,config.host, function () {
	console.log('%s listening at %s', server.name, server.url)
})

// MOAR FEEDS!!!!

if (!fs.existsSync(config.subscriptions)) {
	console.log('could not find',config.subscriptions)
	process.exit(2)
}


// imports
if (config.argv['import-greader-starred'])
	importer.google_reader_starred(config.argv['import-greader-starred'])




// REPLACE WITH SUBSCRIPTIONS MANAGER, importing this
// load subscriptions file
var parser = new xml2js.Parser();
fs.readFile(config.subscriptions, function(err, data) {
	parser.parseString(data, function (err, result) {
		if (err) {
			console.error(err)
			process.exit(1)
		}

		var feeds = result.opml.body[0].outline
		var urls  = []

		for (var i in feeds)
			if (feeds[i].$.xmlUrl)
				// no categories
				urls.push(feeds[i].$.xmlUrl)
			else if (feeds[i].outline) {
				// this is a category
				for (var j in feeds[i].outline)
					urls.push(feeds[i].outline[j].$.xmlUrl)
			}

		console.log('Watching',urls.length,'feeds')

		aggregator.watchRssFeeds(urls)
	})
})
