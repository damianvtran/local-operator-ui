import{j as a}from"./jsx-runtime-6qgwzs7k.js";import{S as B}from"./spinner-B2SkZRIb.js";import"./tabs-D6HlMULL.js";import{B as p}from"./tooltip-BdVa6PqK.js";import"./textarea-DG-lIhp0.js";import{r as t}from"./index-DQDNmYQF.js";import{C as le}from"./check-for-updates-button-BL87_79C.js";import{F as k}from"./deferred-updates-store-D3mwuayO.js";import"./index-C8KIgodY.js";import"./index-DrriUsT5.js";import"./middleware-BA0ma3y9.js";var ce={};typeof window.api>"u"&&(window.api={});(typeof process>"u"||!ce)&&(window.process={env:{npm_package_version:"1.0.0"}});const m={version:"2.0.0",releaseNotes:"Bug fixes and performance improvements",files:[],path:"",sha512:"",releaseDate:new Date().toISOString()},pe=()=>{const n=()=>()=>{};window.api.updater||(window.api.updater={checkForUpdates:async()=>Promise.resolve({updateInfo:m,cancellationToken:{}}),checkForBackendUpdates:async()=>Promise.resolve(null),checkForAllUpdates:async()=>Promise.resolve(),getLastInstallAttempt:async()=>null,updateBackend:async()=>Promise.resolve(!0),downloadUpdate:async()=>Promise.resolve([]),quitAndInstall:async()=>!0,onUpdateDevMode:()=>()=>{},onUpdateNpxAvailable:()=>()=>{},onBackendUpdateAvailable:()=>()=>{},onBackendUpdateDevMode:()=>()=>{},onBackendUpdateNotAvailable:()=>()=>{},onBackendUpdateCompleted:()=>()=>{},onBackendUpdateManualRequired:()=>()=>{},onUpdateInstallBlocked:()=>()=>{},onUpdateInstallFailed:()=>()=>{},onUpdateAvailable:n,onUpdateNotAvailable:n,onUpdateDownloaded:n,onUpdateError:n,onUpdateProgress:n,onBeforeQuitForUpdate:n})};pe();const ue=()=>{const n={checkForUpdates:async()=>Promise.resolve({updateInfo:m,cancellationToken:{}}),checkForBackendUpdates:async()=>Promise.resolve(null),checkForAllUpdates:async()=>Promise.resolve(),getLastInstallAttempt:async()=>null,updateBackend:async()=>Promise.resolve(!0),downloadUpdate:async()=>Promise.resolve([]),quitAndInstall:async()=>!0,onUpdateDevMode:e=>(window.triggerUpdateDevMode&&e("Dev mode is active"),()=>{}),onUpdateNpxAvailable:e=>(window.triggerUpdateNpxAvailable&&e({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"npx local-operator-ui@latest"}),()=>{}),onBackendUpdateAvailable:e=>(window.triggerBackendUpdateAvailable&&e({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"pip install --upgrade local-operator"}),()=>{}),onBackendUpdateDevMode:e=>(window.triggerBackendUpdateDevMode&&e("Backend updates are disabled in development mode."),()=>{}),onBackendUpdateNotAvailable:e=>(window.triggerBackendUpdateNotAvailable&&e({version:"1.0.0"}),()=>{}),onBackendUpdateCompleted:e=>(window.triggerBackendUpdateCompleted&&e(),()=>{}),onUpdateAvailable:e=>(window.triggerUpdateAvailable&&e(m),()=>{}),onUpdateNotAvailable:e=>(window.triggerUpdateNotAvailable&&e(m),()=>{}),onUpdateDownloaded:e=>(window.triggerUpdateDownloaded&&e(m),()=>{}),onUpdateError:e=>(window.triggerUpdateError&&e("Failed to check for updates: Network error"),()=>{}),onUpdateProgress:e=>(window.triggerUpdateProgress&&e({percent:50,transferred:512e3,total:1048576,bytesPerSecond:51200,delta:51200}),()=>{}),onBackendUpdateManualRequired:()=>()=>{},onUpdateInstallBlocked:()=>()=>{},onUpdateInstallFailed:()=>()=>{},onBeforeQuitForUpdate:()=>()=>{}};return window.api.updater=n,()=>{}},Be={title:"Common/CheckForUpdatesButton",component:le,parameters:{layout:"centered",docs:{description:{component:"Stories for the CheckForUpdatesButton component"}}},decorators:[(n,e)=>(t.useEffect(()=>ue(),[]),t.useEffect(()=>{window.triggerUpdateNotAvailable=e.parameters.triggerUpdateNotAvailable,window.triggerUpdateError=e.parameters.triggerUpdateError},[e.parameters.triggerUpdateNotAvailable,e.parameters.triggerUpdateError]),a.jsx("div",{className:"p-5",children:a.jsx(n,{})}))],tags:["autodocs"]},N={render:()=>{const n=()=>{const[e,r]=t.useState(!1);return t.useEffect(()=>(window.api.updater.checkForUpdates=async()=>(r(!0),setTimeout(()=>{r(!1)},500),Promise.resolve({updateInfo:m,cancellationToken:{}})),()=>{}),[]),a.jsx("div",{className:"relative min-h-25",children:a.jsxs(p,{variant:"outline",onClick:()=>window.api.updater.checkForUpdates(),disabled:e,children:[e?a.jsx(B,{size:"sm"}):null,e?"Checking...":"Check for updates"]})})};return a.jsx(n,{})}},w={parameters:{triggerUpdateNotAvailable:!0},render:()=>{const n=()=>{const[e,r]=t.useState(!1),[o,i]=t.useState(!1),[u,d]=t.useState(!1);return t.useEffect(()=>{i(!0),d(!0)},[]),t.useEffect(()=>(window.api.updater.checkForUpdates=async()=>(r(!0),d(!1),setTimeout(()=>{var s;r(!1),i(!0),d(!0);const l=((s=window.api.updater._callbacks)==null?void 0:s.updateNotAvailable)||[];for(const c of l)c(m)},500),Promise.resolve({updateInfo:m,cancellationToken:{}})),window.api.updater._callbacks||(window.api.updater._callbacks={}),()=>{}),[]),t.useEffect(()=>{const l=window.api.updater.onUpdateNotAvailable;return window.api.updater.onUpdateNotAvailable=s=>(window.api.updater._callbacks||(window.api.updater._callbacks={}),window.api.updater._callbacks.updateNotAvailable||(window.api.updater._callbacks.updateNotAvailable=[]),window.api.updater._callbacks.updateNotAvailable.push(s),o&&s(m),()=>{var c;(c=window.api.updater._callbacks)!=null&&c.updateNotAvailable&&(window.api.updater._callbacks.updateNotAvailable=window.api.updater._callbacks.updateNotAvailable.filter(b=>b!==s))}),()=>{window.api.updater.onUpdateNotAvailable=l}},[o]),a.jsxs("div",{className:"relative min-h-25",children:[a.jsxs(p,{variant:"outline",onClick:()=>window.api.updater.checkForUpdates(),disabled:e,children:[e?a.jsx(B,{size:"sm"}):null,e?"Checking...":"Check for updates"]}),a.jsx(k,{open:u,autoHideDuration:6e3,onClose:()=>d(!1),variant:"info",children:"You're using the latest version"})]})};return a.jsx(n,{})}},f={parameters:{triggerUpdateError:!0},render:()=>{const n=()=>{const[e,r]=t.useState(!1),[o,i]=t.useState("Failed to check for updates: Network error"),[u,d]=t.useState(!0);return t.useEffect(()=>{i("Failed to check for updates: Network error"),d(!0)},[]),t.useEffect(()=>(window.api.updater.checkForUpdates=async()=>(r(!0),d(!1),setTimeout(()=>{var s;r(!1),i("Failed to check for updates: Network error"),d(!0);const l=((s=window.api.updater._callbacks)==null?void 0:s.updateError)||[];for(const c of l)c("Failed to check for updates: Network error")},500),Promise.reject(new Error("Network error"))),window.api.updater._callbacks||(window.api.updater._callbacks={}),()=>{}),[]),t.useEffect(()=>{const l=window.api.updater.onUpdateError;return window.api.updater.onUpdateError=s=>(window.api.updater._callbacks||(window.api.updater._callbacks={}),window.api.updater._callbacks.updateError||(window.api.updater._callbacks.updateError=[]),window.api.updater._callbacks.updateError.push(s),o&&s(o),()=>{var c;(c=window.api.updater._callbacks)!=null&&c.updateError&&(window.api.updater._callbacks.updateError=window.api.updater._callbacks.updateError.filter(b=>b!==s))}),()=>{window.api.updater.onUpdateError=l}},[o]),a.jsxs("div",{className:"relative min-h-25",children:[a.jsxs(p,{variant:"outline",onClick:()=>window.api.updater.checkForUpdates(),disabled:e,children:[e?a.jsx(B,{size:"sm"}):null,e?"Checking...":"Check for updates"]}),a.jsx(k,{open:u,autoHideDuration:6e3,onClose:()=>d(!1),variant:"danger",children:o})]})};return a.jsx(n,{})}},h={args:{autoCheck:!1},render:()=>{const n=()=>{const[e,r]=t.useState(null),[o,i]=t.useState(!0);return t.useEffect(()=>{r("You're running in development mode. Updates are disabled.");const u=window.api.updater.onUpdateDevMode;return window.api.updater.onUpdateDevMode=d=>(d("You're running in development mode. Updates are disabled."),()=>{}),window.triggerDevMode=!0,()=>{window.api.updater.onUpdateDevMode=u}},[]),a.jsxs("div",{className:"relative min-h-25",children:[a.jsx(p,{variant:"outline",onClick:()=>{},disabled:!1,children:"Check for updates"}),a.jsx(k,{open:o,autoHideDuration:6e3,onClose:()=>i(!1),variant:"info",children:e})]})};return a.jsx(n,{})}},v={args:{autoCheck:!1},render:()=>{const n=()=>{const[e,r]=t.useState(null),[o,i]=t.useState(!0);t.useEffect(()=>{r({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"npx local-operator-ui@latest"});const d=window.api.updater.onUpdateNpxAvailable;return window.api.updater.onUpdateNpxAvailable=l=>(l({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"npx local-operator-ui@latest"}),()=>{}),window.triggerNpxUpdate=!0,()=>{window.api.updater.onUpdateNpxAvailable=d}},[]);const u=()=>{e&&navigator.clipboard.writeText(e.updateCommand)};return a.jsxs("div",{className:"relative min-h-25",children:[a.jsx(p,{variant:"outline",onClick:()=>{},disabled:!1,children:"Check for updates"}),a.jsxs(k,{open:o,autoHideDuration:1e4,onClose:()=>i(!1),variant:"info",action:a.jsx(p,{variant:"ghost",size:"sm",onClick:u,children:"Copy"}),children:[a.jsxs("p",{className:"text-body-sm",children:["Update available: ",e==null?void 0:e.latestVersion," (current:"," ",e==null?void 0:e.currentVersion,")"]}),a.jsxs("p",{className:"text-body-sm",children:["To update, run:"," ",a.jsx("code",{className:"text-mono-sm",children:e==null?void 0:e.updateCommand})]})]})]})};return a.jsx(n,{})}},g={args:{autoCheck:!1},render:()=>{const n=()=>{const[e,r]=t.useState(null),[o,i]=t.useState(!0),[u,d]=t.useState(!1);t.useEffect(()=>{r({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"pip install --upgrade local-operator"});const c=window.api.updater.onBackendUpdateAvailable;return window.api.updater.onBackendUpdateAvailable=b=>(b({currentVersion:"1.0.0",latestVersion:"2.0.0",updateCommand:"pip install --upgrade local-operator"}),()=>{}),window.triggerBackendUpdateAvailable=!0,()=>{window.api.updater.onBackendUpdateAvailable=c}},[]);const l=()=>{e&&navigator.clipboard.writeText(e.updateCommand)},s=()=>{d(!0),setTimeout(()=>{d(!1),r(null),i(!1)},1500)};return a.jsxs("div",{className:"relative min-h-25",children:[a.jsx(p,{variant:"outline",onClick:()=>{},disabled:!1,children:"Check for updates"}),a.jsxs(k,{open:o,autoHideDuration:1e4,onClose:()=>i(!1),variant:"info",action:a.jsxs(a.Fragment,{children:[a.jsx(p,{variant:"ghost",size:"sm",onClick:l,children:"Copy"}),a.jsx(p,{variant:"primary",size:"sm",onClick:s,disabled:u,children:u?"Updating...":"Update"})]}),children:[a.jsxs("p",{className:"text-body-sm",children:["Backend update available: ",e==null?void 0:e.latestVersion," ","(current: ",e==null?void 0:e.currentVersion,")"]}),a.jsxs("p",{className:"text-body-sm",children:["To update manually, run:"," ",a.jsx("code",{className:"text-mono-sm",children:e==null?void 0:e.updateCommand})]})]})]})};return a.jsx(n,{})}},U={args:{autoCheck:!1},render:()=>{const n=()=>{const[e,r]=t.useState(!0);return t.useEffect(()=>{const o=window.api.updater.onBackendUpdateCompleted;return window.api.updater.onBackendUpdateCompleted=i=>(i(),()=>{}),window.triggerBackendUpdateCompleted=!0,()=>{window.api.updater.onBackendUpdateCompleted=o}},[]),a.jsxs("div",{className:"relative min-h-25",children:[a.jsx(p,{variant:"outline",onClick:()=>{},disabled:!1,children:"Check for updates"}),a.jsx(k,{open:e,autoHideDuration:6e3,onClose:()=>r(!1),variant:"success",children:"Backend updated successfully"})]})};return a.jsx(n,{})}},C={args:{autoCheck:!1},render:()=>{const n=()=>{const[e,r]=t.useState(!0);return t.useEffect(()=>{const o=window.api.updater.onBackendUpdateNotAvailable;return window.api.updater.onBackendUpdateNotAvailable=i=>(i({version:"1.0.0"}),()=>{}),window.triggerBackendUpdateNotAvailable=!0,()=>{window.api.updater.onBackendUpdateNotAvailable=o}},[]),a.jsxs("div",{className:"relative min-h-25",children:[a.jsx(p,{variant:"outline",onClick:()=>{},disabled:!1,children:"Check for updates"}),a.jsx(k,{open:e,autoHideDuration:6e3,onClose:()=>r(!1),variant:"info",children:"You're using the latest version"})]})};return a.jsx(n,{})}};var A,S,x;N.parameters={...N.parameters,docs:{...(A=N.parameters)==null?void 0:A.docs,source:{originalSource:`{
  render: () => {
    // Create a component that ensures no snackbar is shown initially
    const DefaultComponent = () => {
      const [checking, setChecking] = useState(false);

      // Override the checkForUpdates function to simulate the flow
      useEffect(() => {
        // Replace with a function that simulates checking but doesn't show any snackbar
        window.api.updater.checkForUpdates = async () => {
          setChecking(true);

          // Simulate a delay for checking
          setTimeout(() => {
            setChecking(false);
          }, 500);
          return Promise.resolve({
            updateInfo: mockUpdateInfo,
            cancellationToken: {}
          });
        };
        return () => {
          // No cleanup needed for the story
        };
      }, []);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => window.api.updater.checkForUpdates()} disabled={checking}>
                        {checking ? <Spinner size="sm" /> : null}
                        {checking ? "Checking..." : "Check for updates"}
                    </Button>
                </div>;
    };
    return <DefaultComponent />;
  }
}`,...(x=(S=N.parameters)==null?void 0:S.docs)==null?void 0:x.source}}};var y,O,E,_,F;w.parameters={...w.parameters,docs:{...(y=w.parameters)==null?void 0:y.docs,source:{originalSource:`{
  parameters: {
    triggerUpdateNotAvailable: true
  },
  render: () => {
    // Create a component that simulates clicking the button and showing "no update available"
    const NoUpdateComponent = () => {
      const [checking, setChecking] = useState(false);
      const [noUpdateAvailable, setNoUpdateAvailable] = useState(false);
      const [snackbarOpen, setSnackbarOpen] = useState(false);

      // Initialize with the snackbar open to show the state
      useEffect(() => {
        setNoUpdateAvailable(true);
        setSnackbarOpen(true);
      }, []);

      // Override the checkForUpdates function to simulate the flow
      useEffect(() => {
        // Replace with a function that simulates checking and then showing "no update available"
        window.api.updater.checkForUpdates = async () => {
          setChecking(true);
          setSnackbarOpen(false); // Close any existing snackbar

          // Simulate a delay for checking
          setTimeout(() => {
            setChecking(false);
            setNoUpdateAvailable(true);
            setSnackbarOpen(true); // Show the snackbar

            // Trigger the onUpdateNotAvailable callback
            const callbacks =
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            window.api.updater._callbacks?.updateNotAvailable || [];
            for (const callback of callbacks) {
              callback(mockUpdateInfo);
            }
          }, 500);
          return Promise.resolve({
            updateInfo: mockUpdateInfo,
            cancellationToken: {}
          });
        };

        // Add a callbacks collection to the mock API if it doesn't exist
        // @ts-ignore - _callbacks is added at runtime for our mock implementation
        if (!window.api.updater._callbacks) {
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          window.api.updater._callbacks = {} as UpdaterCallbacks;
        }
        return () => {
          // No cleanup needed for the story
        };
      }, []);

      // Override the onUpdateNotAvailable to store callbacks
      useEffect(() => {
        const originalOnUpdateNotAvailable = window.api.updater.onUpdateNotAvailable;
        window.api.updater.onUpdateNotAvailable = callback => {
          // Store the callback
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          if (!window.api.updater._callbacks) {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            window.api.updater._callbacks = {} as UpdaterCallbacks;
          }
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          if (!window.api.updater._callbacks.updateNotAvailable) {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            window.api.updater._callbacks.updateNotAvailable = [];
          }
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          window.api.updater._callbacks.updateNotAvailable.push(callback);

          // Call it immediately if we're already in the "no update available" state
          if (noUpdateAvailable) {
            callback(mockUpdateInfo);
          }

          // Return cleanup function
          return () => {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            if (window.api.updater._callbacks?.updateNotAvailable) {
              // @ts-ignore - _callbacks is added at runtime for our mock implementation
              window.api.updater._callbacks.updateNotAvailable =
              // @ts-ignore - _callbacks is added at runtime for our mock implementation
              window.api.updater._callbacks.updateNotAvailable.filter((cb: (info: UpdateInfo) => void) => cb !== callback);
            }
          };
        };
        return () => {
          window.api.updater.onUpdateNotAvailable = originalOnUpdateNotAvailable;
        };
      }, [noUpdateAvailable]);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => window.api.updater.checkForUpdates()} disabled={checking}>
                        {checking ? <Spinner size="sm" /> : null}
                        {checking ? "Checking..." : "Check for updates"}
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} variant="info">
                        You're using the latest version
                    </FloatingAlert>
                </div>;
    };
    return <NoUpdateComponent />;
  }
}`,...(E=(O=w.parameters)==null?void 0:O.docs)==null?void 0:E.source},description:{story:"Shows the button state when no update is available.",...(F=(_=w.parameters)==null?void 0:_.docs)==null?void 0:F.description}}};var D,j,M,I,V;f.parameters={...f.parameters,docs:{...(D=f.parameters)==null?void 0:D.docs,source:{originalSource:`{
  parameters: {
    triggerUpdateError: true
  },
  render: () => {
    // Create a component that simulates clicking the button and showing an error
    const ErrorComponent = () => {
      const [checking, setChecking] = useState(false);
      const [error, setError] = useState<string>("Failed to check for updates: Network error");
      const [snackbarOpen, setSnackbarOpen] = useState(true);

      // Initialize with the error snackbar open to show the state
      useEffect(() => {
        setError("Failed to check for updates: Network error");
        setSnackbarOpen(true);
      }, []);

      // Override the checkForUpdates function to simulate the flow
      useEffect(() => {
        // Replace with a function that simulates checking and then showing an error
        window.api.updater.checkForUpdates = async () => {
          setChecking(true);
          setSnackbarOpen(false); // Close any existing snackbar

          // Simulate a delay for checking
          setTimeout(() => {
            setChecking(false);
            setError("Failed to check for updates: Network error");
            setSnackbarOpen(true); // Show the snackbar

            // Trigger the onUpdateError callback
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            const callbacks = window.api.updater._callbacks?.updateError || [];
            for (const callback of callbacks) {
              callback("Failed to check for updates: Network error");
            }
          }, 500);
          return Promise.reject(new Error("Network error"));
        };

        // Add a callbacks collection to the mock API if it doesn't exist
        // @ts-ignore - _callbacks is added at runtime for our mock implementation
        if (!window.api.updater._callbacks) {
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          window.api.updater._callbacks = {} as UpdaterCallbacks;
        }
        return () => {
          // No cleanup needed for the story
        };
      }, []);

      // Override the onUpdateError to store callbacks
      useEffect(() => {
        const originalOnUpdateError = window.api.updater.onUpdateError;
        window.api.updater.onUpdateError = callback => {
          // Store the callback
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          if (!window.api.updater._callbacks) {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            window.api.updater._callbacks = {} as UpdaterCallbacks;
          }
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          if (!window.api.updater._callbacks.updateError) {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            window.api.updater._callbacks.updateError = [];
          }
          // @ts-ignore - _callbacks is added at runtime for our mock implementation
          window.api.updater._callbacks.updateError.push(callback);

          // Call it immediately if we're already in the error state
          if (error) {
            callback(error);
          }

          // Return cleanup function
          return () => {
            // @ts-ignore - _callbacks is added at runtime for our mock implementation
            if (window.api.updater._callbacks?.updateError) {
              // @ts-ignore - _callbacks is added at runtime for our mock implementation
              window.api.updater._callbacks.updateError =
              // @ts-ignore - _callbacks is added at runtime for our mock implementation
              window.api.updater._callbacks.updateError.filter((cb: (message: string) => void) => cb !== callback);
            }
          };
        };
        return () => {
          window.api.updater.onUpdateError = originalOnUpdateError;
        };
      }, [error]);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => window.api.updater.checkForUpdates()} disabled={checking}>
                        {checking ? <Spinner size="sm" /> : null}
                        {checking ? "Checking..." : "Check for updates"}
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} variant="danger">
                        {error}
                    </FloatingAlert>
                </div>;
    };
    return <ErrorComponent />;
  }
}`,...(M=(j=f.parameters)==null?void 0:j.docs)==null?void 0:M.source},description:{story:"Shows the button state when there's an error checking for updates.",...(V=(I=f.parameters)==null?void 0:I.docs)==null?void 0:V.description}}};var P,T,H,z,R;h.parameters={...h.parameters,docs:{...(P=h.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    autoCheck: false
  },
  render: () => {
    // Create a component that directly renders the dev mode state
    const DevModeComponent = () => {
      // Use state to force the component to render with dev mode message
      const [devModeMessage, setDevModeMessage] = useState<string | null>(null);
      const [snackbarOpen, setSnackbarOpen] = useState(true);
      useEffect(() => {
        // Set the state immediately
        setDevModeMessage("You're running in development mode. Updates are disabled.");

        // Override the onUpdateDevMode method
        const originalOnUpdateDevMode = window.api.updater.onUpdateDevMode;
        window.api.updater.onUpdateDevMode = callback => {
          // Call it immediately
          callback("You're running in development mode. Updates are disabled.");
          return () => {};
        };

        // Set the trigger flag
        window.triggerDevMode = true;
        return () => {
          window.api.updater.onUpdateDevMode = originalOnUpdateDevMode;
        };
      }, []);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => {}} disabled={false}>
                        Check for updates
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} variant="info">
                        {devModeMessage}
                    </FloatingAlert>
                </div>;
    };
    return <DevModeComponent />;
  }
}`,...(H=(T=h.parameters)==null?void 0:T.docs)==null?void 0:H.source},description:{story:"Shows the notification when in development mode.",...(R=(z=h.parameters)==null?void 0:z.docs)==null?void 0:R.description}}};var Y,q,X,L,Q;v.parameters={...v.parameters,docs:{...(Y=v.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  args: {
    autoCheck: false
  },
  render: () => {
    // Create a component that directly renders the NPX update available state
    const NpxUpdateComponent = () => {
      // Use state to force the component to render with NPX update info
      const [npxUpdateInfo, setNpxUpdateInfo] = useState<{
        currentVersion: string;
        latestVersion: string;
        updateCommand: string;
      } | null>(null);
      const [snackbarOpen, setSnackbarOpen] = useState(true);
      useEffect(() => {
        // Set the state immediately
        setNpxUpdateInfo({
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          updateCommand: "npx local-operator-ui@latest"
        });

        // Override the onUpdateNpxAvailable method
        const originalOnUpdateNpxAvailable = window.api.updater.onUpdateNpxAvailable;
        window.api.updater.onUpdateNpxAvailable = callback => {
          // Call it immediately
          callback({
            currentVersion: "1.0.0",
            latestVersion: "2.0.0",
            updateCommand: "npx local-operator-ui@latest"
          });
          return () => {};
        };

        // Set the trigger flag
        window.triggerNpxUpdate = true;
        return () => {
          window.api.updater.onUpdateNpxAvailable = originalOnUpdateNpxAvailable;
        };
      }, []);

      // Handle copying the NPX command to clipboard
      const handleCopyNpxCommand = () => {
        if (npxUpdateInfo) {
          navigator.clipboard.writeText(npxUpdateInfo.updateCommand);
        }
      };
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => {}} disabled={false}>
                        Check for updates
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={10000} onClose={() => setSnackbarOpen(false)} variant="info" action={<Button variant="ghost" size="sm" onClick={handleCopyNpxCommand}>
                                Copy
                            </Button>}>
                        <p className="text-body-sm">
                            Update available: {npxUpdateInfo?.latestVersion} (current:{" "}
                            {npxUpdateInfo?.currentVersion})
                        </p>
                        <p className="text-body-sm">
                            To update, run:{" "}
                            <code className="text-mono-sm">
                                {npxUpdateInfo?.updateCommand}
                            </code>
                        </p>
                    </FloatingAlert>
                </div>;
    };
    return <NpxUpdateComponent />;
  }
}`,...(X=(q=v.parameters)==null?void 0:q.docs)==null?void 0:X.source},description:{story:"Shows the notification when an NPX update is available.",...(Q=(L=v.parameters)==null?void 0:L.docs)==null?void 0:Q.description}}};var G,J,K,W,Z;g.parameters={...g.parameters,docs:{...(G=g.parameters)==null?void 0:G.docs,source:{originalSource:`{
  args: {
    autoCheck: false
  },
  render: () => {
    // Create a component that directly renders the backend update available state
    const BackendUpdateComponent = () => {
      const [backendUpdateInfo, setBackendUpdateInfo] = useState<{
        currentVersion: string;
        latestVersion: string;
        updateCommand: string;
      } | null>(null);
      const [snackbarOpen, setSnackbarOpen] = useState(true);
      const [updatingBackend, setUpdatingBackend] = useState(false);
      useEffect(() => {
        // Set the state immediately
        setBackendUpdateInfo({
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          updateCommand: "pip install --upgrade local-operator"
        });

        // Override the onBackendUpdateAvailable method
        const originalOnBackendUpdateAvailable = window.api.updater.onBackendUpdateAvailable;
        window.api.updater.onBackendUpdateAvailable = callback => {
          // Call it immediately
          callback({
            currentVersion: "1.0.0",
            latestVersion: "2.0.0",
            updateCommand: "pip install --upgrade local-operator"
          });
          return () => {};
        };

        // Set the trigger flag
        window.triggerBackendUpdateAvailable = true;
        return () => {
          window.api.updater.onBackendUpdateAvailable = originalOnBackendUpdateAvailable;
        };
      }, []);

      // Handle copying the backend update command to clipboard
      const handleCopyCommand = () => {
        if (backendUpdateInfo) {
          navigator.clipboard.writeText(backendUpdateInfo.updateCommand);
        }
      };

      // Handle updating the backend
      const updateBackend = () => {
        setUpdatingBackend(true);
        // Simulate backend update
        setTimeout(() => {
          setUpdatingBackend(false);
          setBackendUpdateInfo(null);
          setSnackbarOpen(false);
        }, 1500);
      };
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => {}} disabled={false}>
                        Check for updates
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={10000} onClose={() => setSnackbarOpen(false)} variant="info" action={<>
                                <Button variant="ghost" size="sm" onClick={handleCopyCommand}>
                                    Copy
                                </Button>
                                <Button variant="primary" size="sm" onClick={updateBackend} disabled={updatingBackend}>
                                    {updatingBackend ? "Updating..." : "Update"}
                                </Button>
                            </>}>
                        <p className="text-body-sm">
                            Backend update available: {backendUpdateInfo?.latestVersion}{" "}
                            (current: {backendUpdateInfo?.currentVersion})
                        </p>
                        <p className="text-body-sm">
                            To update manually, run:{" "}
                            <code className="text-mono-sm">
                                {backendUpdateInfo?.updateCommand}
                            </code>
                        </p>
                    </FloatingAlert>
                </div>;
    };
    return <BackendUpdateComponent />;
  }
}`,...(K=(J=g.parameters)==null?void 0:J.docs)==null?void 0:K.source},description:{story:"Shows the notification when a backend update is available.",...(Z=(W=g.parameters)==null?void 0:W.docs)==null?void 0:Z.description}}};var $,ee,ae,te,ne;U.parameters={...U.parameters,docs:{...($=U.parameters)==null?void 0:$.docs,source:{originalSource:`{
  args: {
    autoCheck: false
  },
  render: () => {
    // Create a component that directly renders the backend update completed state
    const BackendUpdateCompletedComponent = () => {
      const [snackbarOpen, setSnackbarOpen] = useState(true);
      useEffect(() => {
        // Override the onBackendUpdateCompleted method
        const originalOnBackendUpdateCompleted = window.api.updater.onBackendUpdateCompleted;
        window.api.updater.onBackendUpdateCompleted = callback => {
          // Call it immediately
          callback();
          return () => {};
        };

        // Set the trigger flag
        window.triggerBackendUpdateCompleted = true;
        return () => {
          window.api.updater.onBackendUpdateCompleted = originalOnBackendUpdateCompleted;
        };
      }, []);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => {}} disabled={false}>
                        Check for updates
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} variant="success">
                        Backend updated successfully
                    </FloatingAlert>
                </div>;
    };
    return <BackendUpdateCompletedComponent />;
  }
}`,...(ae=(ee=U.parameters)==null?void 0:ee.docs)==null?void 0:ae.source},description:{story:"Shows the notification when a backend update has completed.",...(ne=(te=U.parameters)==null?void 0:te.docs)==null?void 0:ne.description}}};var re,oe,ie,de,se;C.parameters={...C.parameters,docs:{...(re=C.parameters)==null?void 0:re.docs,source:{originalSource:`{
  args: {
    autoCheck: false
  },
  render: () => {
    // Create a component that directly renders the backend update not available state
    const BackendUpdateNotAvailableComponent = () => {
      const [snackbarOpen, setSnackbarOpen] = useState(true);
      useEffect(() => {
        // Override the onBackendUpdateNotAvailable method
        const originalOnBackendUpdateNotAvailable = window.api.updater.onBackendUpdateNotAvailable;
        window.api.updater.onBackendUpdateNotAvailable = callback => {
          // Call it immediately
          callback({
            version: "1.0.0"
          });
          return () => {};
        };

        // Set the trigger flag
        window.triggerBackendUpdateNotAvailable = true;
        return () => {
          window.api.updater.onBackendUpdateNotAvailable = originalOnBackendUpdateNotAvailable;
        };
      }, []);
      return <div className="relative min-h-25">
                    <Button variant="outline" onClick={() => {}} disabled={false}>
                        Check for updates
                    </Button>

                    <FloatingAlert open={snackbarOpen} autoHideDuration={6000} onClose={() => setSnackbarOpen(false)} variant="info">
                        You're using the latest version
                    </FloatingAlert>
                </div>;
    };
    return <BackendUpdateNotAvailableComponent />;
  }
}`,...(ie=(oe=C.parameters)==null?void 0:oe.docs)==null?void 0:ie.source},description:{story:"Shows the notification when no backend update is available.",...(se=(de=C.parameters)==null?void 0:de.docs)==null?void 0:se.description}}};const Ae=["ButtonDefault","ButtonNoUpdateAvailable","ButtonErrorState","DevMode","NpxUpdateAvailable","BackendUpdateAvailable","BackendUpdateCompleted","BackendUpdateNotAvailable"];export{g as BackendUpdateAvailable,U as BackendUpdateCompleted,C as BackendUpdateNotAvailable,N as ButtonDefault,f as ButtonErrorState,w as ButtonNoUpdateAvailable,h as DevMode,v as NpxUpdateAvailable,Ae as __namedExportsOrder,Be as default};
