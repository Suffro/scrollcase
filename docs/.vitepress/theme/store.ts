import { reactive } from 'vue'
import pkg from '../../../package.json'

const packageVersion = pkg.version
const schemaVersion = pkg.schemaVersion

export const globalStore = reactive({
  packageVersion,
  schemaVersion
})