import functools
import http.server
import sys

# Vite's static preview preloads more than five assets concurrently; the default
# HTTPServer backlog drops connections before their CSS/module requests arrive.
class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
Server(('127.0.0.1', int(sys.argv[2])), handler).serve_forever()
