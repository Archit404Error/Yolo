from flask import Flask, jsonify, request
import mysql.connector
import requests

app = Flask(__name__)

mydb = mysql.connector.connect(
  host="sql5.freesqldatabase.com",
  user="sql5432499",
  password="Lp5Tw8l2GR",
  database="sql5432499",
  autocommit = True
 )

cursor = mydb.cursor()

@app.route('/query')
def queryDB():
    cursor.execute("SELECT * FROM Events")
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

@app.route('/queryId')
def idRes():
    cursor.execute("SELECT COUNT(id) FROM Events")
    res = cursor.fetchall()
    return jsonify(res[0][0])

@app.route('/addEvent')
def createEvent():
    params = list(request.args)
    sql = "INSERT into Events(image, title, description, location, other) VALUES ({}, {}, {}, {}, {})".format(params[0], params[1], params[2], params[3], params[4])
    cursor.execute(sql)
    #need to make chat id auto increment
    #need to get chat creator as param
    chat_sql = "INSERT INTO Chats(Event, Messages, Members) VALUES ({}, {}, {})".format(params[1], "Chat Created", "Archit")
    return jsonify(True)

@app.route('/getChats')
def returnChats():
    sql = 'SELECT * FROM Chats WHERE id={}'.format(list(request.args)[0])
    cursor.execute(sql)
    res = cursor.fetchall()
    res_arr = []
    for val in res:
        res_arr.append(val)
    return jsonify(res_arr)

@app.route('/sendMessage')
def sendMess():
    params = list(request.args)
    message = params[0]
    sender = params[1]
    toAdd = sender + ":" + message
    #Add UPDATE statement here
    sql = ""
    cursor.execute(sql)
    return jsonify("OK")

@app.route('/updateEventPreference')
def changeEvent():
    params = list(request.args)
    user = params[0]
    operation = params[1]
    initial_state = params[2]
    event_id = params[3]

    cursor.execute("SELECT " + initial_state + "Events from Users WHERE Name=\'" + user + "\'")
    initial_list = list(cursor.fetchall()[0])
    initial_list[0] = initial_list[0][:-1]
    initial_list[len(initial_list) - 1] = initial_list[len(initial_list) - 1][1:]
    print(initial_list)
    initial_list.remove(str(event_id))

    cursor.execute("SELECT " + operation + "Events from Users WHERE Name=\'" + user + "\'")
    mutated_list = list(cursor.fetchall()[0])
    mutated_list.append(str(event_id))

    initial_list = str(initial_list.join(', '))
    mutated_list = str(mutated_list.join(', '))

    print(initial_list)
    print(mutated_list)
    return jsonify("OK")

if __name__ == "__main__":
    app.run(debug=True)
