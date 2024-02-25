const dotenv = require("dotenv");
dotenv.config()
const WhatsApp = require("whatsapp");
const { addListener } = require("./messageListener");

// Your test sender phone number
const wa = new WhatsApp( process.env.WA_PHONE_NUMBER_ID );

// Enter the recipient phone number
const recipient_number = "+49 1754863246";
// const recipient_number = "+49 176 30168140"
async function send_message(message, recipient_number)
{
    try{
        const sent_text_message = wa.messages.text( { "body" : message }, recipient_number );

        await sent_text_message.then( ( res ) =>
        {
            // console.log( res.rawResponse() );
            console.log("success");
        } );
    }
    catch( e )
    {
        console.log("error",e)
        // console.log( JSON.stringify( e ) );
    }
}

send_message("hello tom", recipient_number);

addListener(({from, text}) => {
  console.log("dummy listener received", text, "from", from);
  send_message(text, from);
});


