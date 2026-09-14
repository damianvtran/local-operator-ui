"""Disposable production diagnostic router for browser evidence; no live stores."""
import os
import tempfile
from pathlib import Path

# Isolate before importing anything that can resolve a default home/cache path.
with tempfile.TemporaryDirectory(prefix='coder165-wire-') as home:
    for key in list(os.environ):
        if key.startswith(('CMUX_', 'LOP_')):
            del os.environ[key]
    os.environ.update(HOME=home, LOCAL_OPERATOR_CONFIG_DIR=str(Path(home) / 'config'),
                      LOCAL_OPERATOR_DESKTOP_TOKEN='synthetic-storybook-evidence',
                      LOCAL_OPERATOR_DESKTOP_ORIGINS='http://localhost:6051')
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
    from local_operator.config import ConfigManager
    from local_operator.server.routes import desktop_catalogues

    app = FastAPI()
    app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:6051'],
                       allow_methods=['GET'], allow_headers=['Authorization'])
    app.include_router(desktop_catalogues.router)
    app.state.config_manager = ConfigManager(Path(home) / 'config')
    print('Isolated production diagnostics ready for browser evidence on localhost:6052', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=6052, log_level='warning')
