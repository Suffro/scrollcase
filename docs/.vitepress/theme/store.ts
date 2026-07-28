import { reactive } from 'vue'
import pkg from '../../../package.json'

const packageVersion = pkg.version

export const globalStore = reactive({
  packageVersion
})