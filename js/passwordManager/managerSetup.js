var { ipcRenderer } = require('electron')
var fs = require('fs')
var path = require('path')

var webviews = require('webviews.js')
var settings = require('util/settings/settings.js')
var browserUI = require('browserUI.js')
var modalMode = require('modalMode.js')

var dialog = document.getElementById('manager-setup-dialog')

var primaryInstructions = document.getElementById('manager-setup-instructions-primary')
var secondaryInstructions = document.getElementById('manager-setup-instructions-secondary')
var dragBox = document.getElementById('manager-setup-drop-box')

const setupDialog = {
  manager: null,
  setupMode: null,
  installerCompletionTimeout: null,
  show: function (manager, setupMode) {
    setupDialog.manager = manager
    setupDialog.setupMode = setupMode

    document.getElementById('manager-setup-heading').textContent = l('passwordManagerSetupHeading').replace('%p', manager.name)
    document.getElementById('password-manager-setup-link').textContent = l('passwordManagerSetupLink').replace('%p', manager.name)
    document.getElementById('password-manager-setup-link-installer').textContent = l('passwordManagerSetupLinkInstaller').replace('%p', manager.name)

    if (setupMode === 'installer') {
      primaryInstructions.hidden = true
      dragBox.hidden = true
      secondaryInstructions.hidden = false

      setupDialog.installerCompletionTimeout = setTimeout(waitForInstallerComplete, 2000)
    } else {
      primaryInstructions.hidden = false
      dragBox.hidden = false
      secondaryInstructions.hidden = true
    }

    modalMode.toggle(true)
    dialog.hidden = false
    webviews.requestPlaceholder('managerSetup')
  },
  hide: function () {
    setupDialog.manager = null
    setupDialog.setupMode = null
    clearTimeout(setupDialog.installerCompletionTimeout)
    setupDialog.installerCompletionTimeout = null

    modalMode.toggle(false)
    dialog.hidden = true
    webviews.hidePlaceholder('managerSetup')
  },
  initialize: function () {
    document.getElementById('manager-setup-disable').addEventListener('click', function () {
      settings.set('passwordManager', null)
      setupDialog.hide()
    })

    document.getElementById('manager-setup-cancel').addEventListener('click', function () {
      setupDialog.hide()
    })

    document.getElementById('password-manager-setup-link').addEventListener('click', function () {
      browserUI.addTab(tabs.add({
        url: setupDialog.manager.getDownloadLink()
      }), { openInBackground: true })
    })

    document.getElementById('password-manager-setup-link-installer').addEventListener('click', function () {
      browserUI.addTab(tabs.add({
        url: setupDialog.manager.getDownloadLink()
      }), { openInBackground: true })
    })

    dragBox.ondragover = () => {
      return false
    }

    dragBox.ondragleave = () => {
      return false
    }

    dragBox.ondragend = () => {
      return false
    }

    dragBox.ondrop = (e) => {
      e.preventDefault()

      if (e.dataTransfer.files.length === 0) {
        return
      }

      dragBox.innerHTML = l('passwordManagerSetupInstalling')

      const filePath = e.dataTransfer.files[0].path

      // try to filter out anything that isn't an executable (note: not 100% accurate)
      if (e.dataTransfer.files[0].type !== '' && !e.dataTransfer.files[0].name.endsWith('.exe')) {
        dragBox.innerHTML = l('passwordManagerSetupRetry')
        return
      }

      install(filePath).then(afterInstall)

      return false
    }
  }
}

function waitForInstallerComplete () {
  setupDialog.manager.checkIfConfigured().then(function (configured) {
    if (configured) {
      afterInstall()
      setupDialog.installerCompletionTimeout = null
    } else {
      setupDialog.installerCompletionTimeout = setTimeout(waitForInstallerComplete, 2000)
    }
  })
}

// Install the tool into the Min user folder.
function install (filePath, callback) {
  return new Promise((resolve, reject) => {
    try {
      let toolsDir = path.join(window.userDataPath, 'tools')
      if (!fs.existsSync(toolsDir)) {
        fs.mkdirSync(toolsDir)
      }

      let targetFilePath = path.join(toolsDir, setupDialog.manager.getFileName())
      fs.createReadStream(filePath).pipe(fs.createWriteStream(targetFilePath)).on('finish', function () {
        fs.chmodSync(targetFilePath, '755')
        resolve(targetFilePath)
      }).on('error', function (error) {
        reject(error)
      })
    } catch (e) {
      reject(e)
    }
  })
}

function afterInstall (toolPath) {
  var signInFields = [
        { placeholder: l('email'), id: 'email', type: 'text' },
        { placeholder: l('password'), id: 'password', type: 'password' },
        { placeholder: l('secretKey'), id: 'secretKey', type: 'password' }
  ].filter(f => setupDialog.manager.getSignInRequirements().includes(f.id))

    // Verify the tool by trying to use it to unlock the password store.
  let data = ipcRenderer.sendSync('prompt', {
    text: l('passwordManagerSetupSignIn'),
    values: signInFields,
    ok: l('dialogConfirmButton'),
    cancel: l('dialogSkipButton'),
    width: 500,
    height: 220
  })

  if (!data.email || !data.password) {
    throw new Error('no credentials entered')
  }
  setupDialog.manager.signInAndSave(data, toolPath)
    .then(() => {
      setupDialog.hide()
    })
    .catch(function (e) {
      console.warn(e)
      if (setupDialog.setupMode === 'installer') {
        // show the dialog again
        afterInstall()
      } else {
        // Cleanup after we failed.
        let targetFilePath = path.join(window.userDataPath, 'tools', setupDialog.manager.getFileName())
        if (fs.existsSync(targetFilePath)) {
          fs.unlinkSync(targetFilePath)
        }

        const message = (e.error || '').replace(/\n$/gm, '')
        dragBox.innerHTML = l('passwordManagerSetupUnlockError') + message + ' ' + l('passwordManagerSetupRetry')
      }
    })
}

setupDialog.initialize()

module.exports = setupDialog