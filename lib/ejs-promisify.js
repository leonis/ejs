'use strict';

const _ = require('lodash');
const co = require('co');
const ejs = require('./ejs');
const utils = require('./utils');
const rp = require('request-promise');

const cookie = require('cookie');

module.exports = new class {
  constructor() {
    const self = this;
    this.opt;
    this.headers = {};

    this.upperLowerPattern = (str) => {
      const pattern = (str) => {
        return str.split('').map((char) => {
          if (char.toLowerCase() === char.toUpperCase()) {
            return [char];
          }
          return [char.toLowerCase(), char.toUpperCase()];
        });
      };
      function combine() {
        const args = [].slice.call(arguments, 0);
        const a = args.shift() || [];
        const b = args.shift() || [];
        let result = [];
        for (const val1 of a) {
          for (const val2 of b) {
            result.push(val1.concat(val2));
          }
        }
        if (args.length > 0) {
          for (const arg of args) {
            result = combine(result, arg);
          }
        }
        return result;
      }
      return combine.apply(null, pattern(str));
    };
    this.cookieNames = this.upperLowerPattern('set-cookie');

    this.getCookieNames = () => {
      return self.cookieNames;
    };
    /*
    [setCookie]
    setCookie('name', 'value', {
      domain: null,
      encode: ecodeURIComponent,
      expires: '',
      httpOnly: false,
      maxAge: '',
      path: '/',
      secure: false
    });
    */
    this.setCookie = (name, value, options) => {
      options = options || {};
      self.headers[self.cookieNames[Object.keys(self.headers).length]] = cookie.serialize(name, value, options);
    };
    this.getHeaders = () => {
      return self.headers;
    };

    /*
    [リダイレクト]
    redirect('URL');
    */
    this.redirect = (location) => {
      return new Promise((resolve, reject) => {
        const error = new Error(location);
        error.name = 'location';
        return reject(error);
      });
    };

    /*
    [リクエスト]
    var response = yield request('メソッド', 'URL', {
      headers:{'キー':'値'},
      query:{'キー':'値'},
      body:{'キー':'値'},
      timeout:3000
    });
    */
    this.request = (method, uri, options) => {
      options = options || {};
      const headers = {};
      Object.keys(options.headers || {}).forEach((key) => {
        headers[key.toLowerCase()] = options.headers[key];
      });
      const params = {
        method: method,
        uri: uri,
        qs: options.query,
        headers: headers,
        simple: false,
        resolveWithFullResponse: true,
        json: true
      };
      params.headers['content-length'] = options.body && options.body.length;
      if (_.isObject(options.body)){
        params.form = options.body;
      }else if(!options.body){
        params.body = options.body;
      }

      if (options.timeout) {
        params.timeout = options.timeout;
      }
      return rp(params);
    };

    /*
    [リダイレクト並列]
    var responses = yield requests([{method:'メソッド', url:'URL', options:{
      headers:{'キー':'値'},
      query:{'キー':'値'},
      body:{'キー':'値'},
      timeout:3000
    }}]);
    */
    this.requests = (requests) => {
      const responses = [];
      for (let i = 0; i < requests.length; i++) {
        responses.push(self.request(requests[i].method, requests[i].url, requests[i].options));
      }
      return responses;
    };

    this.loadTemplate = null;

    /*
    [インクルード]
    yield includeTemplate('screen_header_ejs || screen_footer_ejs');
    */
    this.includeTemplate = (name) => {
      return co(function * () {
        if (typeof self.loadTemplate !== 'function'){
          return Promise.reject(new Error('Not Found ejs.loadTemplate'));
        }
        const template = yield self.loadTemplate(name);
        return yield self.compile(template, self.opts);
      });
    };

    this.staticPath = (path) => {
      if (typeof self._staticPath !== 'function') {
        throw new Error('Not Method ejs._staticPath');
      }
      return self._staticPath(path);
    };

    this.staticThemePath = (path) => {
      if (typeof self._staticThemePath !== 'function') {
        throw new Error('Not Method ejs._staticThemePath');
      }
      return self._staticThemePath(path);
    };

    this.compile = (template, opts) => {
      opts[ejs.localsName] = opts[ejs.localsName] || {};
      self.opts = opts;

      const templ = new ejs.Template(template, self.opts);

      try {
        templ.generateSource();
      } catch (e) {
        return Promise.reject(new SyntaxError(e.message));
      }

      const source = templ.source;

      const compileSource = `
      var __line = 1;
      var __lines = ${JSON.stringify(templ.templateText)};
      var __filename;
      var __output = [], __append = __output.push.bind(__output);
      with (this) {
        return co(function *() {
          ${source}
          return __output.join('');
        }.bind(this)).catch ((e) => {
          rethrow(e, __lines, __filename, __line);
        });
      }`;

      // 禁止
      Object.keys(global).forEach((key) => {
        self.opts[self.localsName][key] = undefined;
      });
      // おまけ
      self.opts[self.localsName].eval = undefined;
      self.opts[self.localsName].Function = undefined;

      const fn = new Function(
        'setCookie, redirect, request, requests, includeTemplate, co, escapeFn, rethrow, staticPath, staticThemePath',
        compileSource); // eslint-disable-line no-new-func
      const rethrow = (err, str, flnm, lineno) => {
        const lines = str.split('\n');
        const start = Math.max(lineno - 3, 0);
        const end = Math.min(lines.length, lineno + 3);
        const filename = utils.escapeXML(flnm);
        // Error context
        const context = lines.slice(start, end).map((line, i) => {
          const curr = i + start + 1;
          return `${(curr === lineno ? ' >> ' : '    ')}${curr}| ${line}`;
        }).join('\n');

        // Alter exception message
        err.path = filename;
        // err.message = `${(filename || 'ejs')}:${lineno}\n${context}\n\n${err.message}`;
        err.lineNumber = lineno;
        err.description = `${(filename || 'ejs')}:${lineno}\n${context}`;
        throw err;
      };
      return fn.call(self.opts[self.localsName],
        self.setCookie,
        self.redirect,
        self.request,
        self.requests,
        self.includeTemplate,
        co,
        utils.escapeXML,
        rethrow,
        self.staticPath,
        self.staticThemePath
      );
    };

    // コンパイルソース取得
    this.render = (template, opts) => {
      self.headers = {};
      return self.compile(template, opts).then((source) => {
        return source;
      });
    };
  }
}();
