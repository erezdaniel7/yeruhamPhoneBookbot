var request = require('request');
var csvWriter = require('csv-write-stream');
var fs = require("fs");
var striptags = require('striptags');
var async = require('async');
var Entities = require('html-entities').XmlEntities;
var entities = new Entities();
var config = require('./config');

var phonebook=[];
var tinyurls={};
var lastUpdateID=0;
var first=true;
var userList={};

function updatePhonebook(callback){
	request('https://script.googleusercontent.com/macros/echo?user_content_key=v4rN8LfTupMB5BjVBkq1wVfnq3BSjY8GxbUv78jqbfvM_HPnLyLercbYXRJU9MSt_CVCWoOvZmgFwiJWuU53uLRo4raI0zolm5_BxDlH2jW0nuo2oDemN9CCS2h10ox_1xSncGQajx_ryfhECjZEnG9dQciN2XmMsbkBBTQnYpwHEK5xcmv6-BEVOyJJbdMymwMWJ4hrAWXopN3YEEwwiyNrHjD4-88NJ0-vvvFHWKo&lib=Myhj4Xa1LxkXTs5EmJ-HTwox32lPoSxpO', function (error, response, body) {
		if (!error && response.statusCode == 200) {
			body=body.trim();
			body=body.substring(18);
			newPhoneBook=JSON.parse(body).pages;
			async.each(newPhoneBook, set_telegram_text,
				function(data){
					phonebook=newPhoneBook;
					savePhoneBook();
					console.log("phonebook update");
					writeToLog("updatePhonebook",response.statusCode,null);
					if(callback) callback();
				}
			);
		}
		else{
			writeToLog("updatePhonebook-error","",error);
			if(callback) callback(error);
		}
	})
}

function getMessage(){
	var now=Date.now();
	// longPolling api
	request('https://api.telegram.org/bot'+config.botToken+'/getUpdates?offset='+lastUpdateID+'&timeout='+(first?0:10000), function (error, response, body) {
		if (!error && response.statusCode == 200) {
			data=JSON.parse(body);	
			for(var i=0;i<data.result.length;i++){
				var row=data.result[i];
				console.log("----------------------------------");
				console.log(row);
				console.log("----------------------------------");	
				if (!first){
					if (row.message != undefined && row.message.contact != undefined && row.message.contact.user_id==row.message.from.id){
						if (validateNumber(row.message.contact.phone_number)){
							userList[row.message.contact.user_id]=row.message.contact.phone_number;
							sendMessage(row.message.chat.id,"האימות בוצע בהצלחה. \nהקלד שם לחיפוש");
							writeToLog("active user success",row.message.contact.phone_number,row);
							saveUserList();
						}
						else{
							sendMessage(row.message.chat.id,"האימות נכשל. \nספר הטלפונים פתוח לתושבי ירוחם בלבד.\nתושבי ירוחם מוזמנים ליצור קשר עם שמוליק בשביל להכנס למאגר @splintor");
							writeToLog("active user unSuccess",row.message.contact.phone_number,row);
						}
					}
					else if (row.message != undefined && row.message.text == "עדכןעכשיו" && row.message.from.id in userList){
						writeToLog("updatePhonebookRequest",row.message.text,row);
						updatePhonebook(function(err){
							if (!err)
								sendMessage(row.message.chat.id,"ספר הטלפונים עודכן בהצלחה");
							else
								sendMessage(row.message.chat.id,"שגיאה בעדכון ספר הטלפונים");
						})
					}
					else if (row.message != undefined && row.message.from.id in userList){
						writeToLog("find",row.message.text,row);
						if (row.message.text.length<2)
							sendMessage(row.message.chat.id,"מילת החיפוש קצרה מידי");
						else{
							list=find(row.message.text);
							if (list.length==0)
								sendMessage(row.message.chat.id,"לא נמצאו תוצאות");
							else if(list.length==1)
								sendContent(row.message.chat.id,list[0]);
							else if (list.length==2 && list[0].telegram_text.length+list[1].telegram_text.length<=500){ 
								sendContent(row.message.chat.id,list[0]);
								sendContent(row.message.chat.id,list[1]);
							}
							else if (list.length==3 && list[0].telegram_text.length+list[1].telegram_text.length+list[2].telegram_text.length<=500){
								sendContent(row.message.chat.id,list[0]);
								sendContent(row.message.chat.id,list[1]);
								sendContent(row.message.chat.id,list[2]);
							}
							else if (list.length>50)
								sendMessage(row.message.chat.id,"נמצאו יותר מ-50 תוצאות. חפש מחדש...");
							else{
								showListContent(row.message.chat.id,list);
							}
						}
					}
					else if (row.callback_query != undefined){
						writeToLog("sendContent",row.callback_query.data,row);
						var content=getContent(row.callback_query.data);
						if(content)
							sendContent(row.callback_query.message.chat.id,content);
						else
							sendMessage(row.callback_query.message.chat.id,"שגיאה");
					}
					else if (row.message != undefined){
						if (row.message.text.trim()=="שלח מספר טלפון"){
							writeToLog("updateTelegram",row.message.text,row);
							sendMessage(row.message.chat.id,"בשביל להשתמש בספר הטלפונים יש צורך לעדכן גירסת טלגרם.");
						}
						else{
							writeToLog("sendContactRequest",row.message.text,row);
							sendContactRequest(row.message.chat.id);
						}
					}
					else if (row.inline_query != undefined){
						if (row.inline_query.from.id in userList){
							writeToLog("find_inline",row.inline_query.query,row);
							if (row.inline_query.query.length>=2){
								list=find(row.inline_query.query);
								if (list.length<=50 && list.length>0 )
									showListContentInline(row.inline_query.id,list);
								else{
									answerInlineQuery(row.inline_query.id,[]);
								}
							}
							else{
								answerInlineQuery(row.inline_query.id,[]);
							}
						}
						else{
							writeToLog("find_inline_sendContactRequest",row.inline_query.query,row);
							answerInlineQuery(row.inline_query.id,null,true)
						}
					}
					else{
						writeToLog("error","",row);
					}
				}
				lastUpdateID=row.update_id+1;
			}
			first=false;
		}
		getMessage();
	})
}

function set_telegram_text(content,callback){
	var text ="<b>"+content.title+"</b><br>"+content.html;
	text = text.replace(/\n/g, ' ');
	text = text.replace(/\u00a0/g, ' ');
	text = text.replace(/href="http([^"]*)"[^>]*>([^<(http)]*)</g, '>$2 http$1<');
	text = text.replace(/href='http([^']*)'[^>]*>([^<(http)]*)</g, '>$2 http$1<');

	text = text.replace(/<\/div/g, '\n<\/div');
	text = text.replace(/<div/g, '\n<\/div');
	text = text.replace(/<li>/g, '\n* <li>');
	text = text.replace(/\b0((\d-*){8,9})\b/g, '+972$1').replace(/(\+972\d*)-((\d*)-)?((\d*)-)?/g, '$1$3$5').replace(/(\+972)(\d|\d{2})(\d{7})\b/g, '$1-$2-$3');
	text = text.replace(/<\/td/g, ' </td');
	text = text.replace(/<\/th/g, ' </th');
	text = text.replace(/<\/tr/g, '\n</tr');
	text = text.replace(/<br/g, '\n<br');
	text = striptags(text,"<b>");
	var geturl = new RegExp(
          "(^|[ \t\r\n])((http|https):(([A-Za-z0-9$_.+!*(),;/?:@&~=-])|%[A-Fa-f0-9]{2}){2,}(#([a-zA-Z0-9][a-zA-Z0-9$_.+!*(),;/?:@&~=%-]*))?([A-Za-z0-9$_+!*();/?:~-]))"
         ,"g"
       );
	var urls=text.match(geturl);
	if(!urls) urls=[];
	urls.sort(function(a, b){
	  return b.length - a.length;
	});
	async.eachSeries(urls, 
		function(url,callback){
			url=url.trim();
			getTinyurl(url,function(tinyurl){
				text = text.replaceAll(url, " "+tinyurl+" ");
				callback();
			})
		},
		function(){
			text = text.replace(/\n\s*\n/g, '\n');
			text = text.replace(/\s*\n\s*/g, '\n');		
			content.telegram_text=text;
			callback();
		}
	);

}

function getTinyurl(url,callback){
	if (tinyurls[url])
		callback(tinyurls[url]);
	else if(url.search("www.facebook.com")>=0 || url.search("sites.google.com/site/yeruchamphonebook/")>0 || url.search("https://twitter.com/")>=0  ){
		tinyurls[url]="";
		callback(tinyurls[url]);
	}
	else{
		request('http://tinyurl.com/api-create.php?url='+entities.decode(url), function (error, response, body) {
			if (!error && response.statusCode == 200 && body!='""Error""') {
				tinyurls[url]=body.substr(7);
				callback(tinyurls[url]);
				saveTinyurl();
				writeToLog("getTinyurl",url,body);
			}
			else{
				writeToLog("getTinyurl-error",url,error + body);
				callback(url);
			}
		})
	}
}

function sendContent(chatID,content){
	sendMessage(chatID,content.telegram_text)
}

function sendContactRequest(chatID){
	sendMessage(chatID,"נא ללחוץ על הכפתור מטה בשביל לאמת את מספר הטלפון.",{keyboard: [[{text: "שלח מספר טלפון",request_contact: true}]]});
}

function showListContent(chatID,list){
	var inline_keyboard=[];
	for(var i=0;i<list.length;i++){
		inline_keyboard.push([{"text": list[i].title,"callback_data": list[i].name}]);
	}
	var text ="נמצאו "+list.length+" תוצאות";
	sendMessage(chatID,text,{inline_keyboard: inline_keyboard});
}

function showListContentInline(inline_query_id,list){
	var results=[];
	for(var i=0;i<list.length;i++){
		results.push({
				type:"article",
				id:list[i].name,
				title:list[i].title,
				description : list[i].text, 
				input_message_content:{
					message_text: list[i].telegram_text,
					parse_mode: "html"
				}
			});
	}
	answerInlineQuery(inline_query_id,results);
}

function validateNumber(number) {
	number = number.replace(/^\+?972/,'0');

    for (var i = 0; i < phonebook.length; ++i) {
        var p = phonebook[i];
        if (p.text.replace(/[-\.]/g, '').indexOf(number) >= 0) {
            return true;
        }
    }
    return false;
}

function find(word){
	word=word.toLowerCase();
	var split=word.split(" ");
	var ans=[];
	for (var i = 0; i < phonebook.length; ++i) {
		var p = phonebook[i];
		var count=0;
		for (var j=0;j<split.length; j++){
			if (p.title.indexOf(split[j]) >= 0 || p.text.indexOf(split[j]) >= 0) {
				count++
			}	
		}
		if (count==split.length)
			ans.push(p);
	}
	return ans;
}

function getContent(name){
    for (var i = 0; i < phonebook.length; ++i) {
        if (phonebook[i].name==name) {
            return phonebook[i];
        }
    }
    return null;
}

function sendMessage(chatID,text,reply_markup){
	request.post(
		'https://api.telegram.org/bot'+config.botToken+'/sendMessage',
		{ form: {
				chat_id: chatID,
				text: text,
				reply_markup:JSON.stringify(reply_markup || {hide_keyboard:true}),
				parse_mode:"html"}},
		function (error, response, body) {
			console.log("...................................");
			console.log(body);
			console.log("...................................");
		}
	);
}

function answerInlineQuery(inline_query_id,results,invalid_user){
	var form= {
				inline_query_id: inline_query_id,
				results: JSON.stringify(results),
				is_personal:true,
			}
	if (invalid_user){
		form.switch_pm_text="לחץ לאימות המשתמש";
		form.switch_pm_parameter="/start";
		form.cache_time=0;
	}
	request.post(
		'https://api.telegram.org/bot'+config.botToken+'/answerInlineQuery',
		{ form: form},
		function (error, response, body) {
			console.log("...................................");
			console.log(body);
			console.log("...................................");
		}
	);
}

var firstLog=true;
function writeToLog(action,text,o){
	var logrow={
		time:new Date().toISOString(),
		userID:"",
		username:"",
		name:"",
		chatID:"",
		action:action,
		text:text,
		json:JSON.stringify(o)};

	if(o && o.message && o.message.contact && o.message.contact.user_id)
		logrow.userID=o.message.contact.user_id;
	else if(o && o.message && o.message.from && o.message.from.id)
		logrow.userID=o.message.from.id;
	else if(o && o.callback_query && o.callback_query.from && o.callback_query.from.id)
		logrow.userID=o.callback_query.from.id;
	else if(o && o.inline_query && o.inline_query.from && o.inline_query.from.id)
		logrow.userID=o.inline_query.from.id;

	if(o && o.message && o.message.from && o.message.from.usernam)
		logrow.username=o.message.from.username;
	else if(o && o.callback_query && o.callback_query.from && o.callback_query.from.username)
		logrow.username=o.callback_query.from.username;
	else if(o && o.inline_query && o.inline_query.from && o.inline_query.from.username)
		logrow.username=o.inline_query.from.username;

	if(o && o.message && o.message.chat && o.message.chat.id)
		logrow.chatID=o.message.chat.id;
	else if(o && o.callback_query && o.callback_query.message && o.callback_query.message.chat && o.callback_query.message.chat.id)
		logrow.chatID=o.callback_query.message.chat.id;
	else if(o && o.inline_query && o.inline_query.id)
		logrow.chatID=o.inline_query.id;		

	if(o && o.message && o.message.from && o.message.from.first_name && o.message.from.last_name)
		logrow.name=o.message.from.first_name + " " + o.message.from.last_name;
	else if(o && o.callback_query && o.callback_query.from && o.callback_query.from.first_name && o.callback_query.from.last_name)
		logrow.name=o.callback_query.from.first_name + " " + o.callback_query.from.last_name;
	else if(o && o.inline_query && o.inline_query.from && o.inline_query.from.first_name && o.inline_query.from.last_name)
		logrow.name=o.inline_query.from.first_name + " " + o.inline_query.from.last_name;

		
	var writer = csvWriter({sendHeaders: firstLog})
	writer.pipe(fs.createWriteStream('log.csv',{flags: 'a'}));// 'a' means appending (old data will be preserved)
	writer.write(logrow)
	writer.end()
	firstLog=false;
}

function loadFiles(callback){
	async.each(["userList","phonebook","tinyurls"], 
			function(file, callback) {
					fs.readFile(file+".json", 'utf8', function (err,data) {
						if (!err) {
							if (file=="userList") userList=JSON.parse(data);
							else if (file=="phonebook") phonebook=JSON.parse(data);
							else if (file=="tinyurls") tinyurls=JSON.parse(data);
						} 
					});	
					callback();
			}, callback);
	

}

function saveUserList(){
	saveToFile("userList",userList);
}

function savePhoneBook(){
	saveToFile("phonebook",phonebook);
}

function saveTinyurl(){
	saveToFile("tinyurls",tinyurls);
}

function saveToFile(name,data){
	fs.writeFile(name+".json", JSON.stringify(data), function(err) {
	}); 
}


loadFiles(function(){
	updatePhonebook();
	setInterval(updatePhonebook, 86400000); //day
	getMessage();
	console.log("start");
	writeToLog("start","",null);
});

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.split(search).join(replacement);
};