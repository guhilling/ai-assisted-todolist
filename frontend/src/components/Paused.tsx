import panda from '../assets/paused-panda.svg'
import { useI18n } from '../i18n/context'

type PausedProps = {
  /** The deployment's name for its environment, such as "QA"; null when it gives none. */
  environmentName: string | null
}

/**
 * What a visitor sees while the environment is down: its backend is switched off to save money,
 * and nothing is broken. Saying so -- with a panda that is clearly not in a hurry -- beats
 * "sign-in is not configured", which was true only in the narrowest sense.
 */
function Paused({ environmentName }: Readonly<PausedProps>) {
  const { messages } = useI18n()
  return (
    <div className="signed-out">
      <h1 className="signed-out-title">TaskFest</h1>
      <img className="paused-panda" src={panda} alt={messages.paused.panda} width={240} height={240} />
      <p className="paused-message">
        {messages.paused.message(environmentName)}
      </p>
    </div>
  )
}

export default Paused
